import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { LoadingScreen } from "@/components/loading-spinner";

import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";
import AdminDashboard from "@/pages/admin/dashboard";
import ClientesPage from "@/pages/admin/clientes";
import LocalidadesPage from "@/pages/admin/localidades";
import CamerasPage from "@/pages/admin/cameras";
import CameraLivePage from "@/pages/admin/camera-live";
import CameraGalleryPage from "@/pages/admin/camera-gallery";
import TimelapsesPage from "@/pages/admin/timelapses";
import ContasPage from "@/pages/admin/contas";
import ClientLoginPage from "@/pages/client-login";
import ClienteDashboard from "@/pages/cliente/dashboard";

function AdminRoutes() {
  return (
    <Switch>
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/clientes" component={ClientesPage} />
      <Route path="/admin/contas" component={ContasPage} />
      <Route path="/admin/localidades" component={LocalidadesPage} />
      <Route path="/admin/cameras" component={CamerasPage} />
      <Route path="/admin/cameras/:id/live" component={CameraLivePage} />
      <Route path="/admin/cameras/:id/galeria" component={CameraGalleryPage} />
      <Route path="/admin/timelapses" component={TimelapsesPage} />
      <Route path="/">
        <AdminDashboard />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Switch>
      {/* Client portal routes — JWT auth, no Replit Auth needed */}
      <Route path="/login" component={ClientLoginPage} />
      <Route path="/cliente/dashboard" component={ClienteDashboard} />

      {/* Admin routes — require Replit Auth */}
      {user ? (
        <Route path="/:rest*" component={AdminRoutes} />
      ) : (
        <Route path="/:rest*" component={LandingPage} />
      )}
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="skylapse-theme">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
