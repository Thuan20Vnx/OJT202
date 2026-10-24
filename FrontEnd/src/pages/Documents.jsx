import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Chip, Confirm, Empty, ErrorBox, Field, Icon, Modal, Notice, PageHeader, PageLoader, Pagination, Select, Spinner } from '../components/ui.jsx';
import { api, download, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { fileIcon, fileSize, fmtDateTime, timeAgo } from '../lib/format.js';
import { useProjectInfo, useSocketEvent } from '../lib/hooks.js';

const ALLOWED = /\.(pdf|txt|png|jpe?g)$/i;

export default function Documents() {
  const { project, canWriteProject, me } = useApp();
  const info = useProjectInfo(project?._id);
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [f, setF] = useState({ search: '', type: '', uploadedBy: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [rejected, setRejected] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newDoc, setNewDoc] = useState(false);
  const input = useRef(null);
  const params = { ...f, kind: tab === 'docs' ? 'doc' : tab === 'files' ? 'file' : '', mine: tab === 'mine' ? 'true' : '', page, limit: 20 };
  const { data, error, loading, reload } = useLoad(() => (project ? api.get(`/projects/${project._id}/documents${qs(params)}`) : Promise.resolve(null)), [project?._id, JSON.stringify(params)]);
  useSocketEvent('documents:changed', () => reload(), [reload]);

  useEffect(() => {
    if (data?.documents?.length && !selected) setSelected(data.documents[0]._id);
  }, [data, selected]);

  if (!project) return <Empty icon="folder_off" title="Chưa có dự án" />;

  const upload = async (list) => {
    const files = [...list];
    const bad = files.filter((x) => !ALLOWED.test(x.name) || x.size > 10 * 1024 * 1024);
    setRejected(bad.map((x) => (x.size > 10 * 1024 * 1024 ? `${x.name} vượt quá 10MB` : `${x.name} không được hỗ trợ – chỉ nhận PDF, TXT, PNG, JPG`)));
    const ok = files.filter((x) => !bad.includes(x));
    if (!ok.length) return;
    const fd = new FormData();
    ok.forEach((x) => fd.append('files', x));
    setUploading(true);
    try {
      const d = await api.upload(`/projects/${project._id}/documents/upload`, fd);
      toast(`Đã tải lên ${d.documents.length} tệp`);
      reload();
    } catch (e) {
      setRejected((r) => [...r, e.message]);
    } finally {
      setUploading(false);
    }
  };

  const counts = data?.counts || {};
  return (
    <div className="p-6">
      <PageHeader
        title="Tài liệu"
        subtitle={`${project.name} · ${counts.doc || 0} tài liệu văn bản · ${counts.file || 0} tệp đính kèm`}
        actions={
          canWriteProject && (
            <>
              <button className="btn-outline" onClick={() => input.current?.click()}>
                <Icon name="upload" size={16} /> Tải tệp lên
              </button>
              <button className="btn-primary" onClick={() => setNewDoc(true)}>
                <Icon name="add" size={16} /> Tài liệu mới
              </button>
            </>
          )
        }
      />
      <input ref={input} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
      {canWriteProject && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => (e.preventDefault(), upload(e.dataTransfer.files))}
          className="mb-3 flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-white px-4 py-3"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">{uploading ? <Spinner /> : <Icon name="cloud_upload" />}</span>
          <div className="flex-1">
            <p className="text-body-sm font-semibold text-slate-800">Kéo thả tệp vào đây · PDF, TXT, PNG, JPG – tối đa 10MB</p>
            <p className="text-label-md font-normal text-slate-500">Hoặc chọn tệp từ máy tính. Không nhận tệp thực thi.</p>
          </div>
          <button className="btn-outline btn-sm" onClick={() => input.current?.click()}>
            Duyệt tệp
          </button>
        </div>
      )}
      {rejected.map((r) => (
        <Notice key={r} tone="danger" className="mb-2">
          {r}
        </Notice>
      ))}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="card min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            {[
              ['all', 'Tất cả'],
              ['docs', 'Tài liệu văn bản'],
              ['files', 'Tệp đính kèm'],
              ['mine', 'Của tôi'],
            ].map(([v, l]) => (
              <button key={v} className={`pill-tab ${tab === v ? 'pill-tab-active' : ''}`} onClick={() => (setTab(v), setPage(1))}>
                {l}
              </button>
            ))}
            <div className="relative ml-auto">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-8 w-52 pl-8 text-body-sm" placeholder="Tìm theo tên tài liệu" value={f.search} onChange={(e) => (setF({ ...f, search: e.target.value }), setPage(1))} />
            </div>
            <Select className="input h-8 w-auto py-0 text-body-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="">Loại tệp</option>
              {['pdf', 'txt', 'png', 'jpg'].map((x) => (
                <option key={x} value={x}>
                  {x.toUpperCase()}
                </option>
              ))}
            </Select>
            <Select className="input h-8 w-auto py-0 text-body-sm" value={f.uploadedBy} onChange={(e) => setF({ ...f, uploadedBy: e.target.value })}>
              <option value="">Người tải lên</option>
              {(info?.project?.members || []).map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <ErrorBox error={error} onRetry={reload} />
          {loading && !data ? (
            <PageLoader />
          ) : !data?.documents.length ? (
            <Empty icon="folder_open" title="Chưa có tài liệu">Tải tệp lên hoặc tạo tài liệu văn bản mới.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className="table-th">Tên tài liệu</th>
                    <th className="table-th">Công việc liên kết</th>
                    <th className="table-th">Người tải lên</th>
                    <th className="table-th">Kích thước</th>
                    <th className="table-th">Cập nhật</th>
                    <th className="table-th">Phiên bản</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.documents.map((d) => {
                    const ic = fileIcon(d.name);
                    return (
                      <tr key={d._id} onClick={() => setSelected(d._id)} className={`cursor-pointer hover:bg-slate-50 ${selected === d._id ? 'bg-blue-50/60' : ''}`}>
                        <td className="table-td">
                          <div className="flex items-center gap-2.5">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ic.color}`}>
                              <Icon name={ic.icon} size={18} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{d.name}</p>
                              {d.isScan && <span className="chip mt-0.5 border-amber-200 bg-amber-50 text-amber-700">Ảnh scan – không dùng cho Trợ lý AI</span>}
                            </div>
                          </div>
                        </td>
                        <td className="table-td whitespace-nowrap">
                          {d.task ? (
                            <button onClick={(e) => (e.stopPropagation(), navigate({ search: `?task=${d.task._id}` }))} className="chip border-slate-200 bg-white font-mono text-blue-700">
                              {d.task.key}
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="table-td whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <Avatar user={d.uploadedBy} size={22} />
                            {d.uploadedBy?.name}
                          </span>
                        </td>
                        <td className="table-td whitespace-nowrap text-slate-500">{fileSize(d.size)}</td>
                        <td className="table-td whitespace-nowrap text-slate-500">{timeAgo(d.updatedAt)}</td>
                        <td className="table-td">{d.kind === 'doc' ? <Chip className="border-blue-200 bg-blue-50 text-blue-700">v{d.version}</Chip> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination page={page} total={data.total} limit={20} onPage={setPage} />
            </div>
          )}
          <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-label-md font-normal text-slate-500">
            <Icon name="lock" size={14} /> Chỉ thành viên dự án mới tải xuống được tệp.
          </p>
        </div>
        {selected && <Preview id={selected} onDeleted={() => (setSelected(null), reload())} me={me} />}
      </div>
      <NewDocModal open={newDoc} onClose={() => setNewDoc(false)} projectId={project._id} onCreated={(d) => (setSelected(d._id), reload())} />
    </div>
  );
}

function Preview({ id, onDeleted, me }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [viewRev, setViewRev] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, loading, reload } = useLoad(() => api.get(`/documents/${id}`), [id]);
  useEffect(() => {
    setEditing(false);
    setViewRev(null);
  }, [id]);
  if (loading && !data) return <div className="card"><PageLoader /></div>;
  if (!data) return null;
  const d = data.document;
  const ic = fileIcon(d.name);
  const canWrite = data.access.canWrite;
  const isText = d.kind === 'doc' || d.mime === 'text/plain';

  const save = async (body) => {
    setBusy(true);
    try {
      await api.patch(`/documents/${d._id}`, { ...body, version: d.version });
      toast(body.restoreVersion ? `Đã khôi phục v${body.restoreVersion}` : 'Đã lưu phiên bản mới');
      setEditing(false);
      setViewRev(null);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const showRev = async (v) => {
    const r = await api.get(`/documents/${d._id}/revisions/${v}`);
    setViewRev(r.revision);
  };

  return (
    <div className="card h-fit p-4">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${ic.color}`}>
          <Icon name={ic.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-lg font-semibold text-slate-900">{d.name}</p>
          {d.task && <p className="text-label-md font-normal text-slate-500">Liên kết {d.task.key}</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {isText && canWrite && (
          <button className="btn-outline btn-sm" onClick={() => (setEditing(true), setContent(d.preview || ''))}>
            <Icon name="edit" size={16} /> Chỉnh sửa
          </button>
        )}
        <button className="btn-primary btn-sm" onClick={() => download(`/documents/${d._id}/download`, d.name)}>
          <Icon name="download" size={16} /> Tải xuống
        </button>
      </div>
      <dl className="mt-4 space-y-1.5 text-body-sm">
        {[
          ['Người tải lên', d.uploadedBy?.name],
          ['Cập nhật', fmtDateTime(d.updatedAt)],
          ['Kích thước', fileSize(d.size)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      {editing ? (
        <div className="mt-4">
          <textarea className="textarea min-h-[220px] font-mono text-body-sm" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-outline btn-sm" onClick={() => setEditing(false)}>
              Hủy
            </button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => save({ content })}>
              {busy && <Spinner />}Lưu phiên bản mới
            </button>
          </div>
        </div>
      ) : isText ? (
        <div className="mt-4">
          <p className="section-label mb-1.5">{viewRev ? `Nội dung v${viewRev.version}` : 'Trích đoạn nội dung'}</p>
          <pre className="scroll-thin max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-[12px] leading-5 text-slate-700">{(viewRev ? viewRev.content : d.preview) || '(trống)'}</pre>
          {viewRev && (
            <button className="mt-1 text-label-md text-blue-600" onClick={() => setViewRev(null)}>
              ← Về bản hiện tại
            </button>
          )}
        </div>
      ) : (
        <Notice tone={d.isScan ? 'warn' : 'info'} className="mt-4">
          {d.isScan ? 'Ảnh/scan được lưu nhưng không được đọc (OCR) cho Trợ lý AI.' : 'Tệp PDF – tải xuống để xem nội dung.'}
        </Notice>
      )}
      {d.kind === 'doc' && d.revisions?.length > 0 && (
        <div className="mt-4">
          <p className="section-label mb-2">Lịch sử phiên bản ({d.revisions.length})</p>
          <div className="space-y-1.5">
            {d.revisions.map((r, i) => (
              <div key={r._id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-body-sm">
                <span className="font-semibold text-slate-800">v{r.version}</span>
                <span className="flex-1 truncate text-label-md font-normal text-slate-500">
                  {r.author?.name} · {timeAgo(r.createdAt)}
                </span>
                {i === 0 ? (
                  <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">Hiện tại</span>
                ) : (
                  <>
                    <button className="text-label-md text-blue-600" onClick={() => showRev(r.version)}>
                      Xem
                    </button>
                    {canWrite && (
                      <button className="text-label-md text-slate-500 hover:text-slate-800" onClick={() => save({ restoreVersion: r.version })}>
                        Khôi phục
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {canWrite && d.uploadedBy?._id === me?._id && (
        <button className="mt-4 text-label-md text-rose-600 hover:underline" onClick={() => setConfirm(true)}>
          Xóa tài liệu
        </button>
      )}
      <Confirm
        open={confirm}
        danger
        title="Xóa tài liệu?"
        confirmText="Xóa"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await api.del(`/documents/${d._id}`);
          setConfirm(false);
          onDeleted();
        }}
      >
        Tài liệu “{d.name}” sẽ bị xóa vĩnh viễn.
      </Confirm>
    </div>
  );
}

function NewDocModal({ open, onClose, projectId, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const { document } = await api.post(`/projects/${projectId}/documents`, { name, content });
      toast('Đã tạo tài liệu');
      setName('');
      setContent('');
      onCreated(document);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tài liệu văn bản mới"
      icon="description"
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={submit}>
            {busy && <Spinner />}Tạo tài liệu
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên tài liệu" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Biên bản họp Sprint 15" />
        </Field>
        <Field label="Nội dung" hint="Tài liệu văn bản được Trợ lý AI dùng làm nguồn trả lời. Mỗi lần lưu tạo một phiên bản mới.">
          <textarea className="textarea min-h-[240px]" value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
