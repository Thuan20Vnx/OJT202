import { Link } from 'react-router-dom';
import { Empty, Icon, PageLoader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/app.jsx';
import { fmtDateTime } from '../lib/format.js';

/** Hộp thư dev: hiển thị email hệ thống "gửi" khi chưa cấu hình SMTP (chỉ có ở môi trường phát triển). */
export default function DevOutbox() {
  const { data, loading, error, reload } = useLoad(() => api.get('/dev/outbox'), []);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-headline-lg text-slate-900">Hộp thư dev</h1>
          <p className="text-body-sm text-slate-500">Email xác minh, đặt lại mật khẩu và lời mời được lưu ở đây khi chưa cấu hình SMTP.</p>
        </div>
        <button className="btn-outline" onClick={reload}>
          <Icon name="refresh" size={16} /> Làm mới
        </button>
      </div>
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <Empty icon="block" title="Không khả dụng">Hộp thư dev chỉ bật khi server chạy ở chế độ phát triển.</Empty>
      ) : !data.mails.length ? (
        <Empty icon="mail" title="Chưa có email" />
      ) : (
        <div className="space-y-2">
          {data.mails.map((m) => (
            <div key={m._id} className="card p-4">
              <div className="flex items-center justify-between text-label-md font-normal text-slate-500">
                <span>Tới: {m.to}</span>
                <span>{fmtDateTime(m.createdAt)}</span>
              </div>
              <p className="mt-1 text-body-md font-semibold text-slate-900">{m.subject}</p>
              <p className="text-body-sm text-slate-600">{m.text}</p>
              {m.link && (
                <Link className="mt-2 inline-flex items-center gap-1 text-body-sm font-semibold text-blue-600 hover:underline" to={m.link.replace(/^https?:\/\/[^/]+/, '')}>
                  <Icon name="link" size={16} /> Mở liên kết
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
