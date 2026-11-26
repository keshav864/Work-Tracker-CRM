import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { TimerProvider } from "./lib/timer";
import { Layout } from "./components/Layout";
import { PageLoader, Toaster } from "./components/ui";

const LoginPage = lazy(() => import("./pages/Login").then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const MyTasksPage = lazy(() => import("./pages/MyTasks").then((m) => ({ default: m.MyTasksPage })));
const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const ProjectPage = lazy(() => import("./pages/Project").then((m) => ({ default: m.ProjectPage })));
const ClientsPage = lazy(() => import("./pages/Clients").then((m) => ({ default: m.ClientsPage })));
const ClientPage = lazy(() => import("./pages/Client").then((m) => ({ default: m.ClientPage })));
const TimePage = lazy(() => import("./pages/Time").then((m) => ({ default: m.TimePage })));
const TeamPage = lazy(() => import("./pages/Team").then((m) => ({ default: m.TeamPage })));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <TimerProvider>
      <Layout />
    </TimerProvider>
  );
}

function App() {
  const { user } = useAuth();
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Protected />}>
        <Route index element={<DashboardPage />} />
        <Route path="my-tasks" element={<MyTasksPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientPage />} />
        <Route path="time" element={<TimePage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
