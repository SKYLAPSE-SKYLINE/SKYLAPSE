import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ClientMe = {
  id: string;
  nome: string;
  email: string;
  clienteId: string | null;
  cameraIds: string[];
};

export default function ClienteDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: me, isLoading, error } = useQuery<ClientMe>({
    queryKey: ["/api/client/me"],
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/client/logout"),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login");
    },
    onError: () => {
      toast({ title: "Erro ao sair", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (error) {
      navigate("/login");
    }
  }, [error]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Camera className="h-10 w-10 text-primary mx-auto animate-pulse" />
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Camera className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="font-bold text-lg">SKYLAPSE</span>
            <p className="text-xs text-muted-foreground">Portal do Cliente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">{me?.nome}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-client-logout"
          >
            <LogOut className="h-4 w-4 mr-1" />
            Sair
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-client-welcome">
            Olá, {me?.nome?.split(" ")[0]}!
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Você tem acesso a {me?.cameraIds?.length || 0} câmera{(me?.cameraIds?.length || 0) !== 1 ? "s" : ""}.
          </p>
        </div>

        {(!me?.cameraIds || me.cameraIds.length === 0) ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Camera className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                Nenhuma câmera disponível no momento.
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Entre em contato com o suporte para mais informações.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Suas Câmeras
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {me.cameraIds.length} câmera{me.cameraIds.length !== 1 ? "s" : ""} disponível{me.cameraIds.length !== 1 ? "is" : ""}.
                A visualização completa será implementada em breve.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
