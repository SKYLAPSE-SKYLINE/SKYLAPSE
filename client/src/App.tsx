import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { LoadingScreen } from "@/components/loading-spinner";
import { useEffect } from "react";

import NotFound from "@/pages/not-found";
import AdminDashboard from "@/pages/admin/dashboard";
import ClientesPage from "@/pages/admin/clientes";
import LocalidadesPage from "@/pages/admin/localidades";
import CamerasPage from "@/pages/admin/cameras";
import CameraLivePage from "@/pages/admin/camera-live";
import CameraGalleryPage from "@/pages/admin/camera-gallery";
import TimelapsesPage from "@/pages/admin/timelapses";
import ContasPage from "@/pages/admin/contas";
import AdminSettingsPage from "@/pages/admin/settings";
import LoginPage from "@/pages/client-login";
import ClienteDashboard from "@/pages/cliente/dashboard";
import ClienteCameraCaptures from "@/pages/cliente/camera-captures";
import ResetSenhaPage from "@/pages/cliente/reset-senha";

function ClientProtectedRoute({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { isLoading, isError } = useQuery<unknown>({
    queryKey: ["/api/client/me"],
    retry: false,
  });

  useEffect(() => {
    if (isError) navigate("/login");
  }, [isError, navigate]);

  if (isLoading || isError) return <LoadingScreen />;

  return <>{children}</>;
}

function AdminProtectedRoute({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/login");
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <LoadingScreen />;

  return <>{children}</>;
}

function AppRouter() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/cliente/reset-senha" component={ResetSenhaPage} />
      <Route path="/cliente/dashboard">
        <ClientProtectedRoute>
          <ClienteDashboard />
        </ClientProtectedRoute>
      </Route>
      <Route path="/cliente/cameras/:id/capturas">
        <ClientProtectedRoute>
          <ClienteCameraCaptures />
        </ClientProtectedRoute>
      </Route>
      <Route path="/admin/dashboard"><AdminProtectedRoute><AdminDashboard /></AdminProtectedRoute></Route>
      <Route path="/admin/clientes"><AdminProtectedRoute><ClientesPage /></AdminProtectedRoute></Route>
      <Route path="/admin/contas"><AdminProtectedRoute><ContasPage /></AdminProtectedRoute></Route>
      <Route path="/admin/localidades"><AdminProtectedRoute><LocalidadesPage /></AdminProtectedRoute></Route>
      <Route path="/admin/cameras/:id/live"><AdminProtectedRoute><CameraLivePage /></AdminProtectedRoute></Route>
      <Route path="/admin/cameras/:id/galeria"><AdminProtectedRoute><CameraGalleryPage /></AdminProtectedRoute></Route>
      <Route path="/admin/cameras"><AdminProtectedRoute><CamerasPage /></AdminProtectedRoute></Route>
      <Route path="/admin/timelapses"><AdminProtectedRoute><TimelapsesPage /></AdminProtectedRoute></Route>
      <Route path="/admin/configuracoes"><AdminProtectedRoute><AdminSettingsPage /></AdminProtectedRoute></Route>
      <Route path="/" component={LoginPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="skylapse-theme">
        <TooltipProvider>
          <Toaster />
          <AppRouter />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
