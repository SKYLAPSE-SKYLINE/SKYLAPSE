import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, KeyRound, User, Globe, Camera, Wifi, WifiOff, Copy, Check, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/hooks/use-auth";

interface AdminAccountDTO {
  id: string;
  nome: string;
  email: string;
  createdAt: string;
}

const newAccountSchema = z.object({
  nome: z.string().min(1, "Nome obrigatório"),
  email: z.string().email("E-mail inválido"),
  senha: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

const changePasswordSchema = z.object({
  senha: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  confirmar: z.string(),
}).refine((d) => d.senha === d.confirmar, {
  message: "As senhas não coincidem",
  path: ["confirmar"],
});

type NewAccountValues = z.infer<typeof newAccountSchema>;
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

function NewAdminDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<NewAccountValues>({
    resolver: zodResolver(newAccountSchema),
    defaultValues: { nome: "", email: "", senha: "" },
  });

  const mutation = useMutation({
    mutationFn: (data: NewAccountValues) => apiRequest("POST", "/api/admin/accounts", data),
    onSuccess: () => {
      toast({ title: "Conta criada com sucesso" });
      form.reset();
      setOpen(false);
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Erro ao criar conta", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-admin-account">
          <Plus className="h-4 w-4 mr-2" />
          Nova conta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conta administrativa</DialogTitle>
          <DialogDescription>Crie uma nova conta de acesso ao painel administrativo.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="nome" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl>
                  <Input placeholder="Nome completo" {...field} data-testid="input-admin-nome" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="admin@empresa.com" {...field} data-testid="input-admin-email" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="senha" render={({ field }) => (
              <FormItem>
                <FormLabel>Senha</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Mínimo 6 caracteres" {...field} data-testid="input-admin-senha" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-admin-create-submit">
                {mutation.isPending ? "Criando..." : "Criar conta"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { senha: "", confirmar: "" },
  });

  const mutation = useMutation({
    mutationFn: (data: ChangePasswordValues) =>
      apiRequest("PUT", `/api/admin/accounts/${accountId}`, { senha: data.senha }),
    onSuccess: () => {
      toast({ title: "Senha alterada com sucesso" });
      form.reset();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Erro ao alterar senha", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-change-password-${accountId}`}>
          <KeyRound className="h-3.5 w-3.5 mr-1.5" />
          Alterar senha
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
          <DialogDescription>Defina uma nova senha para esta conta.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="senha" render={({ field }) => (
              <FormItem>
                <FormLabel>Nova senha</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Mínimo 6 caracteres" {...field} data-testid="input-new-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="confirmar" render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmar senha</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Repita a senha" {...field} data-testid="input-confirm-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-change-password-submit">
                {mutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

type SystemInfo = {
  portalUrl: string | null;
  cameras: {
    id: string;
    nome: string;
    status: string;
    streamUrl: string | null;
    hostname: string | null;
    ultimaCaptura: string | null;
  }[];
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="text-zinc-400 hover:text-zinc-200 transition-colors shrink-0" title="Copiar">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: accounts = [], isLoading } = useQuery<AdminAccountDTO[]>({
    queryKey: ["/api/admin/accounts"],
  });

  const { data: sysInfo, isLoading: sysLoading, isError: sysError } = useQuery<SystemInfo>({
    queryKey: ["/api/admin/system-info"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts"] });
      toast({ title: "Conta excluída" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Erro ao excluir conta", variant: "destructive" });
    },
  });

  return (
    <AdminLayout title="Configuracoes">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground mt-1">Gerencie as contas de acesso ao painel administrativo.</p>
        </div>

        {/* Sistema */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Sistema
            </CardTitle>
            <CardDescription>Links e status das câmeras e do portal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Portal URL */}
            {sysInfo?.portalUrl && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Portal do Cliente</p>
                <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2.5">
                  <Globe className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="text-sm text-zinc-200 flex-1 truncate font-mono">{sysInfo.portalUrl}</span>
                  <CopyButton text={sysInfo.portalUrl} />
                  <a href={sysInfo.portalUrl} target="_blank" rel="noreferrer"
                    className="text-zinc-400 hover:text-zinc-200 transition-colors shrink-0">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            )}

            {/* Câmeras */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Câmeras</p>
              {sysLoading ? (
                <div className="h-12 rounded-lg bg-zinc-800/40 animate-pulse" />
              ) : sysError ? (
                <p className="text-sm text-zinc-500 py-2">Erro ao carregar. Reinicie o servidor.</p>
              ) : sysInfo?.cameras.length === 0 ? (
                <p className="text-sm text-zinc-500 py-2">Nenhuma câmera cadastrada.</p>
              ) : (
                <div className="space-y-2">
                  {sysInfo?.cameras.map((cam) => (
                    <div key={cam.id} className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2.5 space-y-2">
                      {/* Nome + status */}
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          cam.status === "online"
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                            : "bg-zinc-500"
                        }`} />
                        <span className="text-sm font-medium text-zinc-200 flex-1">{cam.nome}</span>
                        <span className={`text-xs ${cam.status === "online" ? "text-emerald-400" : "text-zinc-500"}`}>
                          {cam.status === "online" ? "Online" : "Offline"}
                        </span>
                      </div>

                      {/* Stream URL */}
                      {cam.streamUrl ? (
                        <div className="flex items-center gap-2">
                          <Wifi className="h-3 w-3 text-blue-400 shrink-0" />
                          <span className="text-xs text-zinc-400 font-mono flex-1 truncate">{cam.streamUrl}</span>
                          <CopyButton text={cam.streamUrl} />
                          <a href={`${cam.streamUrl}/`} target="_blank" rel="noreferrer"
                            className="text-zinc-400 hover:text-zinc-200 transition-colors shrink-0">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      ) : cam.hostname ? (
                        <div className="flex items-center gap-2">
                          <WifiOff className="h-3 w-3 text-zinc-500 shrink-0" />
                          <span className="text-xs text-zinc-500 flex-1 truncate">{cam.hostname}</span>
                        </div>
                      ) : null}

                      {/* Última captura */}
                      {cam.ultimaCaptura && (
                        <p className="text-[11px] text-zinc-500">
                          Última captura:{" "}
                          {formatDistanceToNow(new Date(cam.ultimaCaptura), { addSuffix: true, locale: ptBR })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Contas administrativas
                </CardTitle>
                <CardDescription>Usuários com acesso total ao painel de controle</CardDescription>
              </div>
              <NewAdminDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts"] })} />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">Nenhuma conta encontrada.</p>
            ) : (
              <div className="space-y-3">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    data-testid={`row-admin-account-${account.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{account.nome}</p>
                        {user?.id === account.id && (
                          <Badge variant="secondary" className="text-xs">Você</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{account.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                      <ChangePasswordDialog accountId={account.id} />
                      {user?.id !== account.id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid={`button-delete-admin-${account.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir conta</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir a conta de <strong>{account.nome}</strong>? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(account.id)}
                                className="bg-destructive hover:bg-destructive/90"
                                data-testid={`button-confirm-delete-admin-${account.id}`}
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
