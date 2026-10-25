import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { USER, countBy, ilike, isId, populate, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertWrite, documentAccess, middlewareProject, projectAccess } from '../middleware/access.js';
import { logActivityIn } from '../services/activity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { emitProject } from '../services/realtime.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { pagination } from '../utils/http.js';
import { randomToken } from '../utils/security.js';

const router = Router();
router.use(requireAuth);

const MAX_EDIT_LENGTH = 200000;
const textBody = z.string().max(MAX_EDIT_LENGTH).refine((s) => !s.includes('\u0000'), 'Văn bản không được chứa ký tự NUL');
const isTextDocument = (doc) => doc.kind === 'doc' || doc.mime === 'text/plain';
const originalUpload = (doc) => doc.kind === 'file' && doc.mime === 'text/plain' && doc.version === 1 && doc.storageKey;
const storedPath = (doc) => path.join(config.uploadDir, path.basename(doc.storageKey));

// Uploaded text is cached only for preview/AI. Version 1 remains the original file,
// including legacy uploads whose cached content was truncated.
async function editableContent(doc, enforceLimit = true) {
  if (!isTextDocument(doc)) throw badRequest('Chỉ sửa được tài liệu văn bản');
  let content = doc.content;
  if (originalUpload(doc)) {
    try {
      const bytes = await fs.promises.readFile(storedPath(doc));
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      if (error.code === 'ENOENT') throw notFound('Tệp gốc không còn tồn tại');
      if (error instanceof TypeError) throw badRequest('Tệp không phải UTF-8 hợp lệ. Hãy tải xuống và chỉnh sửa bằng ứng dụng phù hợp.');
      throw error;
    }
  }
  if (enforceLimit && content.length > MAX_EDIT_LENGTH) throw badRequest('Tệp vượt 200.000 ký tự, chỉ hỗ trợ xem trước và tải xuống. Hãy chỉnh sửa trên máy rồi tải lên tệp mới.');
  if (content.includes('\u0000')) throw badRequest('Tệp chứa ký tự NUL, không hỗ trợ chỉnh sửa trực tuyến. Hãy tải xuống tệp gốc.');
  return content;
}

fs.mkdirSync(config.uploadDir, { recursive: true });

// Chỉ nhận PDF/TXT/PNG/JPG – kiểm tra cả đuôi tệp lẫn MIME, không nhận tệp thực thi
const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
};
// Chữ ký đầu tệp (magic bytes) để chặn đổi đuôi
const MAGIC = {
  '.pdf': (b) => b.subarray(0, 4).toString() === '%PDF',
  '.png': (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG',
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.txt': (b) => !b.subarray(0, 512).includes(0),
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED[ext] || !ALLOWED[ext].includes(file.mimetype)) {
      return cb(Object.assign(new Error(`${file.originalname} không được hỗ trợ – chỉ nhận PDF, TXT, PNG, JPG`), { status: 400 }));
    }
    cb(null, true);
  },
});

function fixName(name) {
  // multer giải mã tên tệp theo latin1; chuyển lại UTF-8 cho tên tiếng Việt
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

async function storeFiles(req, project, taskId) {
  // Kiểm tra cả lô trước khi ghi; lỗi tệp thứ hai không để tệp thứ nhất lưu dở dang.
  for (const file of req.files || []) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!MAGIC[ext](file.buffer)) throw badRequest(`${fixName(file.originalname)}: nội dung tệp không khớp định dạng`);
  }
  const written = [];
  try {
    return await withWorkspaceLock(project.workspace, async (tx) => {
      assertWrite(await projectAccess(req.user.id, project.id, tx));
      if (taskId && !(await tx.task.findFirst({ where: { id: taskId, project: project.id } }))) throw badRequest('Công việc không còn thuộc dự án');
      const out = [];
      for (const file of req.files || []) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!MAGIC[ext](file.buffer)) throw badRequest(`${fixName(file.originalname)}: nội dung tệp không khớp định dạng`);
        const key = `${randomToken(16)}${ext}`;
        await fs.promises.writeFile(path.join(config.uploadDir, key), file.buffer);
        written.push(key);
        const isText = ext === '.txt';
        const doc = await tx.document.create({
          data: {
            workspace: project.workspace,
            project: project.id,
            task: taskId ?? null,
            kind: 'file',
            name: fixName(file.originalname).slice(0, 200),
            mime: file.mimetype,
            size: file.size,
            storageKey: key,
            // Ảnh (thường là bản scan) được lưu nhưng không OCR, không dùng cho Trợ lý AI
            isScan: !isText && ext !== '.pdf',
            content: isText ? file.buffer.toString('utf8').slice(0, 200000) : '',
            uploadedBy: req.user.id,
          },
          omit: { storageKey: true },
        });
        await logActivityIn(tx, {
          workspace: project.workspace,
          project: project.id,
          actor: req.user.id,
          action: 'Tải tệp',
          entityType: 'file',
          entityId: doc.id,
          entityLabel: doc.name,
          after: `${doc.name} (${(doc.size / 1024 / 1024).toFixed(1)}MB)`,
        });
        out.push(doc);
      }
      return out;
    });
  } catch (error) {
    await Promise.all(written.map((key) => fs.promises.rm(path.join(config.uploadDir, key), { force: true }).catch(() => {})));
    throw error;
  }
}

const TYPE_EXT = { pdf: ['.pdf'], txt: ['.txt'], png: ['.png'], jpg: ['.jpg', '.jpeg'] };

router.get('/projects/:projectId/documents', middlewareProject(), async (req, res) => {
  const and = [{ project: req.pa.project.id }];
  if (['file', 'doc'].includes(req.query.kind)) and.push({ kind: req.query.kind });
  if (req.query.mine === 'true') and.push({ uploadedBy: req.user.id });
  if (isId(req.query.task)) and.push({ task: req.query.task });
  if (isId(req.query.uploadedBy)) and.push({ uploadedBy: req.query.uploadedBy });
  const exts = TYPE_EXT[String(req.query.type || '').toLowerCase()];
  if (exts) and.push({ OR: exts.map((e) => ({ name: { endsWith: e, mode: 'insensitive' } })) });
  if (req.query.search) and.push({ name: ilike(req.query.search) });
  const where = { AND: and };
  const { page, limit } = pagination(req.query, 20);
  const [docs, total, counts] = await Promise.all([
    prisma.document.findMany({ where, omit: { content: true, storageKey: true }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }).then((r) =>
      populateAll(r, [
        ['uploadedBy', 'user', USER],
        ['task', 'task', { key: true, title: true }],
      ]),
    ),
    prisma.document.count({ where }),
    countBy('document', 'kind', { project: req.pa.project.id }),
  ]);
  res.json({ documents: docs, total, page, limit, counts });
});

router.post('/projects/:projectId/documents/upload', middlewareProject(), upload.array('files', 5), async (req, res) => {
  assertWrite(req.pa);
  let taskId;
  if (req.body.task) {
    const t = isId(req.body.task) ? await prisma.task.findFirst({ where: { id: req.body.task, project: req.pa.project.id }, select: { id: true } }) : null;
    if (!t) throw badRequest('Công việc không thuộc dự án');
    taskId = t.id;
  }
  if (!req.files?.length) throw badRequest('Chưa chọn tệp');
  const docs = await storeFiles(req, req.pa.project, taskId);
  emitProject(req.pa.project.id, 'documents:changed', {});
  res.status(201).json({ documents: docs });
});

router.post('/projects/:projectId/documents', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  const body = parse(
    z.object({ name: z.string().trim().min(1, 'Nhập tên tài liệu').max(200), content: textBody.default(''), task: z.string().optional() }),
    req.body,
  );
  let task = null;
  if (body.task) {
    const t = isId(body.task) ? await prisma.task.findFirst({ where: { id: body.task, project: req.pa.project.id }, select: { id: true } }) : null;
    if (!t) throw badRequest('Công việc không thuộc dự án');
    task = t.id;
  }
  // Stored and rendered as plain text (React escapes it); preserve markup and whitespace.
  const content = body.content;
  const doc = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    assertWrite(await projectAccess(req.user.id, req.pa.project.id, tx));
    if (task && !(await tx.task.findFirst({ where: { id: task, project: req.pa.project.id } }))) throw badRequest('Công việc không còn thuộc dự án');
    const doc = await tx.document.create({
      data: {
        workspace: req.pa.project.workspace,
        project: req.pa.project.id,
        task,
        kind: 'doc',
        name: body.name.endsWith('.txt') ? body.name : `${body.name.slice(0, 196)}.txt`,
        mime: 'text/plain',
        size: Buffer.byteLength(content),
        content,
        version: 1,
        uploadedBy: req.user.id,
        revisions: { create: { version: 1, content, author: req.user.id } },
      },
      omit: { storageKey: true },
    });
    await logActivityIn(tx, {
      workspace: doc.workspace,
      project: doc.project,
      actor: req.user.id,
      action: 'Tạo tài liệu',
      entityType: 'file',
      entityId: doc.id,
      entityLabel: doc.name,
    });
    return doc;
  });
  emitProject(req.pa.project.id, 'documents:changed', {});
  res.status(201).json({ document: doc });
});

// Kiểm tra membership mỗi lần truy cập tài liệu
const docAccess = documentAccess;

router.get('/documents/:id', async (req, res) => {
  const { doc, access } = await docAccess(req.user.id, req.params.id);
  const { storageKey, content, ...full } = doc;
  const [revisions] = await Promise.all([
    prisma.documentRevision.findMany({ where: { document: doc.id }, omit: { content: true }, orderBy: { version: 'desc' } }).then((r) => populate(r, 'author', 'user', USER)),
    populateAll(full, [
      ['uploadedBy', 'user', USER],
      ['task', 'task', { key: true, title: true }],
    ]),
  ]);
  res.json({
    document: { ...full, revisions, preview: doc.kind === 'doc' || doc.mime === 'text/plain' ? content.slice(0, 20000) : undefined },
    access: { canWrite: access.canWrite },
  });
});

router.get('/documents/:id/revisions/:version', async (req, res) => {
  const { doc } = await docAccess(req.user.id, req.params.id);
  const version = Number(req.params.version);
  const valid = /^[1-9]\d*$/.test(req.params.version) && Number.isSafeInteger(version) && version <= 2147483647;
  const rev = valid ? await prisma.documentRevision.findUnique({ where: { document_version: { document: doc.id, version } } }) : null;
  if (!rev) throw notFound('Không tìm thấy phiên bản');
  res.json({ revision: { version: rev.version, content: rev.content, createdAt: rev.createdAt } });
});

// The editor must never initialize itself from the bounded preview.
router.get('/documents/:id/content', async (req, res) => {
  const { doc } = await docAccess(req.user.id, req.params.id);
  res.json({ content: await editableContent(doc), version: doc.version });
});

// Tài liệu văn bản: mỗi lần lưu tạo revision mới, cùng transaction với cập nhật tài liệu
router.patch('/documents/:id', async (req, res) => {
  const { doc, access } = await docAccess(req.user.id, req.params.id);
  assertWrite(access);
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(200).optional(),
      content: textBody.optional(),
      restoreVersion: z.number().int().min(1).max(2147483647).optional(),
      version: z.number().int().min(1).max(2147483647).optional(),
    }),
    req.body,
  );
  let content = body.content;
  if (body.restoreVersion) {
    const rev = await prisma.documentRevision.findUnique({ where: { document_version: { document: doc.id, version: body.restoreVersion } } });
    if (!rev) throw notFound('Không tìm thấy phiên bản');
    content = rev.content;
  }
  if (content !== undefined && doc.kind !== 'doc' && doc.mime !== 'text/plain') throw badRequest('Chỉ sửa được tài liệu văn bản');
  const updated = await withWorkspaceLock(doc.workspace, async (tx) => {
    const fresh = await docAccess(req.user.id, doc.id, tx);
    assertWrite(fresh.access);
    if (fresh.doc.version !== (body.version ?? doc.version)) throw conflict('Tài liệu đã được cập nhật. Hãy tải lại và đối chiếu nội dung trước khi lưu.');
    const data = {};
    if (body.name) data.name = body.name;
    if (content !== undefined || body.name) {
      // Snapshot the complete previous text before the first edit of an upload.
      // Rename also advances version so a stale form cannot overwrite a new name.
      if (isTextDocument(fresh.doc)) {
        const previous = await editableContent(fresh.doc, content !== undefined);
        await tx.documentRevision.upsert({
          where: { document_version: { document: doc.id, version: fresh.doc.version } },
          create: { document: doc.id, version: fresh.doc.version, content: previous, author: fresh.doc.uploadedBy }, update: {},
        });
        const nextContent = content === undefined ? previous : content;
        Object.assign(data, { content: nextContent, size: Buffer.byteLength(nextContent) });
        await tx.documentRevision.create({ data: { document: doc.id, version: fresh.doc.version + 1, content: nextContent, author: req.user.id } });
      }
      data.version = { increment: 1 };
    }
    const updated = await tx.document.update({ where: { id: doc.id }, data, omit: { storageKey: true } });
    await logActivityIn(tx, {
      workspace: updated.workspace,
      project: updated.project,
      actor: req.user.id,
      action: body.restoreVersion ? 'Khôi phục phiên bản' : 'Cập nhật tài liệu',
      entityType: 'file',
      entityId: updated.id,
      entityLabel: updated.name,
      after: `v${updated.version}`,
    });
    return updated;
  });
  emitProject(updated.project, 'documents:changed', {});
  res.json({ document: updated });
});

// Tải xuống qua backend proxy: luôn kiểm tra quyền, không lộ đường dẫn lưu trữ
router.get('/documents/:id/download', async (req, res) => {
  const { doc } = await docAccess(req.user.id, req.params.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
  if (originalUpload(doc)) {
    const file = storedPath(doc);
    if (!fs.existsSync(file)) throw notFound('Tệp gốc không còn tồn tại');
    res.type('text/plain; charset=utf-8');
    return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  if (doc.kind === 'doc' || doc.mime === 'text/plain' || !doc.storageKey) {
    res.type('text/plain; charset=utf-8');
    return res.send(doc.content);
  }
  const file = path.join(config.uploadDir, path.basename(doc.storageKey));
  if (!fs.existsSync(file)) throw notFound('Tệp không còn tồn tại');
  res.type(doc.mime);
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
});

router.delete('/documents/:id', async (req, res) => {
  const { doc, access } = await docAccess(req.user.id, req.params.id);
  assertWrite(access);
  if (doc.uploadedBy !== req.user.id && !access.canManage) throw forbidden('Chỉ người tải lên hoặc quản lý dự án được xóa');
  await withWorkspaceLock(doc.workspace, async (tx) => {
    const fresh = await docAccess(req.user.id, doc.id, tx);
    assertWrite(fresh.access);
    if (fresh.doc.uploadedBy !== req.user.id && !fresh.access.canManage) throw forbidden('Chỉ người tải lên hoặc quản lý dự án được xóa');
    await tx.document.delete({ where: { id: doc.id } }); // lịch sử phiên bản xóa theo (CASCADE)
    await logActivityIn(tx, { workspace: doc.workspace, project: doc.project, actor: req.user.id, action: 'Xóa tệp', entityType: 'file', entityId: doc.id, entityLabel: doc.name });
  });
  if (doc.storageKey) await fs.promises.rm(path.join(config.uploadDir, path.basename(doc.storageKey)), { force: true });
  emitProject(doc.project, 'documents:changed', {});
  res.json({ ok: true });
});

export default router;
