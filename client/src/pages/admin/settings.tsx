import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, KeyRound, User } from "lucide-react";
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

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: accounts = [], isLoading } = useQuery<AdminAccountDTO[]>({
    queryKey: ["/api/admin/accounts"],
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
    <AdminLayout breadcrumbs={[{ label: "Configurações" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground mt-1">Gerencie as contas de acesso ao painel administrativo.</p>
        </div>

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
