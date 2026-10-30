import { t as tr, useI18n } from './lib/i18n.js';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useApp } from './lib/app.jsx';
import AppShell from './components/AppShell.jsx';
import { ErrorBox, PageLoader } from './components/ui.jsx';
import Login from './pages/auth/Login.jsx';
import ForgotPassword from './pages/auth/ForgotPassword.jsx';
import VerifyEmail from './pages/auth/VerifyEmail.jsx';
import Invite from './pages/auth/Invite.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Overview from './pages/Overview.jsx';
import Board from './pages/Board.jsx';
import MyTasks from './pages/MyTasks.jsx';
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Documents = lazy(() => import('./pages/Documents.jsx'));
const Ai = lazy(() => import('./pages/Ai.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
import Risks from './pages/Risks.jsx';
const Settings = lazy(() => import('./pages/settings/Settings.jsx'));
import Profile from './pages/Profile.jsx';
const Admin = lazy(() => import('./pages/Admin.jsx'));
import DevOutbox from './pages/DevOutbox.jsx';

// Chưa biết đã đăng nhập hay chưa vì server không phản hồi: báo rõ và tự thử lại
function Connecting() {
  useI18n();
  const { offline, loadMe } = useApp();
  if (!offline) return <PageLoader />;
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md">
        <ErrorBox error={{ message: tr("Không kết nối được máy chủ. Đang tự thử kết nối lại…") }} onRetry={loadMe} />
      </div>
    </div>
  );
}

function RequireAuth({ children, needWorkspace = true }) {
  useI18n();
  const { me, workspaces } = useApp();
  const loc = useLocation();
  if (me === undefined) return <Connecting />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (needWorkspace && !workspaces.length && !me.isSystemAdmin) return <Navigate to="/onboarding" replace />;
  return children;
}

function PublicOnly({ children }) {
  useI18n();
  const { me } = useApp();
  const loc = useLocation();
  if (me === undefined) return <Connecting />;
  if (me) return <Navigate to={new URLSearchParams(loc.search).get('next') || '/overview'} replace />;
  return children;
}

function WorkspaceGate({ children }) {
  useI18n();
  const { ws, workspaces, me, wsError, reloadWorkspace } = useApp();
  if (!workspaces.length && me?.isSystemAdmin) return <Navigate to="/admin" replace />;
  if (!ws && wsError) {
    return (
      <div className="p-6">
        <ErrorBox error={{ message: tr("Không tải được dữ liệu workspace. Đang thử kết nối lại…") }} onRetry={reloadWorkspace} />
      </div>
    );
  }
  if (!ws) return <PageLoader />;
  return children;
}

export default function App() {
  useI18n();
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <Login initialTab="register" />
            </PublicOnly>
          }
        />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ForgotPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/dev/outbox" element={<DevOutbox />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth needWorkspace={false}>
              <Onboarding />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/admin" element={<Admin />} />
          <Route path="/profile" element={<Profile />} />
          <Route
            path="/overview"
            element={
              <WorkspaceGate>
                <Overview />
              </WorkspaceGate>
            }
          />
          <Route
            path="/board"
            element={
              <WorkspaceGate>
                <Board />
              </WorkspaceGate>
            }
          />
          <Route
            path="/my-tasks"
            element={
              <WorkspaceGate>
                <MyTasks />
              </WorkspaceGate>
            }
          />
          <Route
            path="/calendar"
            element={
              <WorkspaceGate>
                <Calendar />
              </WorkspaceGate>
            }
          />
          <Route
            path="/documents"
            element={
              <WorkspaceGate>
                <Documents />
              </WorkspaceGate>
            }
          />
          <Route
            path="/ai"
            element={
              <WorkspaceGate>
                <Ai />
              </WorkspaceGate>
            }
          />
          <Route
            path="/ai/:tab"
            element={
              <WorkspaceGate>
                <Ai />
              </WorkspaceGate>
            }
          />
          <Route path="/reports" element={<Navigate to="/ai/report" replace />} />
          <Route
            path="/notifications"
            element={
              <WorkspaceGate>
                <Notifications />
              </WorkspaceGate>
            }
          />
          <Route
            path="/projects"
            element={
              <WorkspaceGate>
                <Projects />
              </WorkspaceGate>
            }
          />
          <Route
            path="/risks"
            element={
              <WorkspaceGate>
                <Risks />
              </WorkspaceGate>
            }
          />
          <Route path="/settings" element={<Navigate to="/settings/members" replace />} />
          <Route
            path="/settings/:tab"
            element={
              <WorkspaceGate>
                <Settings />
              </WorkspaceGate>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  );
}
