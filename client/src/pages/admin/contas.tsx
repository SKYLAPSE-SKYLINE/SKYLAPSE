import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AdminLayout } from "@/components/admin-layout";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, UserCog, Camera, Eye, EyeOff } from "lucide-react";
import type { Client, Camera as CameraType } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ClientAccountSafe = {
  id: string;
  clienteId: string | null;
  nome: string;
  email: string;
  status: string;
  createdAt: string;
  cliente?: Client;
  cameraAccess?: { cameraId: string; camera?: CameraType & { localidade?: { nome: string } } }[];
};

type CameraWithLocation = CameraType & {
  localidade?: { nome: string; cliente?: Client };
};

const accountFormSchema = z.object({
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("E-mail inválido"),
  senha: z.string().optional(),
  clienteId: z.string().optional(),
  status: z.enum(["ativo", "inativo"]),
  cameraIds: z.array(z.string()),
}).refine((data) => {
  return true;
});

type AccountFormValues = z.infer<typeof accountFormSchema>;

export default function ContasPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ClientAccountSafe | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const { data: accounts, isLoading } = useQuery<ClientAccountSafe[]>({
    queryKey: ["/api/admin/client-accounts"],
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/admin/clients"],
  });

  const { data: cameras } = useQuery<CameraWithLocation[]>({
    queryKey: ["/api/admin/cameras"],
  });

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      nome: "",
      email: "",
      senha: "",
      clienteId: "",
      status: "ativo",
      cameraIds: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: AccountFormValues) => {
      return apiRequest("POST", "/api/admin/client-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/client-accounts"] });
      toast({ title: "Conta criada com sucesso!" });
      handleCloseDialog();
    },
    onError: async (error: any) => {
      let msg = "Erro ao criar conta";
      try {
        const body = await error.response?.json?.();
        if (body?.message) msg = body.message;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: AccountFormValues & { id: string }) => {
      const { id, ...rest } = data;
      return apiRequest("PUT", `/api/admin/client-accounts/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/client-accounts"] });
      toast({ title: "Conta atualizada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar conta", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/client-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/client-accounts"] });
      toast({ title: "Conta removida com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao remover conta", variant: "destructive" });
    },
  });

  const handleOpenDialog = (account?: ClientAccountSafe) => {
    setShowPassword(false);
    if (account) {
      setEditingAccount(account);
      form.reset({
        nome: account.nome,
        email: account.email,
        senha: "",
        clienteId: account.clienteId || "none",
        status: account.status as "ativo" | "inativo",
        cameraIds: account.cameraAccess?.map((a) => a.cameraId) || [],
      });
    } else {
      setEditingAccount(null);
      form.reset({
        nome: "",
        email: "",
        senha: "",
        clienteId: "",
        status: "ativo",
        cameraIds: [],
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingAccount(null);
    form.reset();
  };

  const onSubmit = (data: AccountFormValues) => {
    const payload = {
      ...data,
      clienteId: (data.clienteId && data.clienteId !== "none") ? data.clienteId : undefined,
      senha: data.senha || undefined,
    };
    if (editingAccount) {
      updateMutation.mutate({ ...payload, id: editingAccount.id });
    } else {
      if (!data.senha || data.senha.length < 6) {
        form.setError("senha", { message: "Senha obrigatória (mínimo 6 caracteres)" });
        return;
      }
      createMutation.mutate(payload);
    }
  };

  const toggleCamera = (cameraId: string) => {
    const current = form.getValues("cameraIds");
    if (current.includes(cameraId)) {
      form.setValue("cameraIds", current.filter((id) => id !== cameraId));
    } else {
      form.setValue("cameraIds", [...current, cameraId]);
    }
  };

  const groupedCameras = cameras?.reduce<Record<string, { locationName: string; cameras: CameraWithLocation[] }>>(
    (acc, cam) => {
      const locId = cam.localidade?.nome || "Sem localidade";
      if (!acc[locId]) {
        acc[locId] = { locationName: locId, cameras: [] };
      }
      acc[locId].cameras.push(cam);
      return acc;
    },
    {}
  );

  const columns = [
    {
      key: "nome",
      header: "Conta",
      cell: (account: ClientAccountSafe) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <UserCog className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-medium" data-testid={`text-account-name-${account.id}`}>{account.nome}</p>
            <p className="text-xs text-muted-foreground">{account.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "cliente",
      header: "Cliente",
      cell: (account: ClientAccountSafe) =>
        account.cliente ? (
          <span className="text-sm">{account.cliente.nome}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "cameras",
      header: "Câmeras",
      cell: (account: ClientAccountSafe) => {
        const count = account.cameraAccess?.length || 0;
        return (
          <div className="flex items-center gap-1">
            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{count} câmera{count !== 1 ? "s" : ""}</span>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (account: ClientAccountSafe) => (
        <StatusBadge status={account.status as "ativo" | "inativo"} />
      ),
    },
    {
      key: "createdAt",
      header: "Criado",
      cell: (account: ClientAccountSafe) =>
        account.createdAt
          ? formatDistanceToNow(new Date(account.createdAt), { addSuffix: true, locale: ptBR })
          : "-",
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      cell: (account: ClientAccountSafe) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); handleOpenDialog(account); }}
            data-testid={`button-edit-account-${account.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remover a conta de "${account.nome}"?`)) {
                deleteMutation.mutate(account.id);
              }
            }}
            data-testid={`button-delete-account-${account.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const selectedCameraIds = form.watch("cameraIds");

  return (
    <AdminLayout
      title="Contas de Clientes"
      breadcrumbs={[
        { label: "Admin", href: "/admin/dashboard" },
        { label: "Contas de Clientes" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">
            Crie e gerencie os acessos dos clientes ao portal
          </p>
          <Button onClick={() => handleOpenDialog()} data-testid="button-add-account">
            <Plus className="mr-2 h-4 w-4" />
            Nova Conta
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={accounts || []}
          isLoading={isLoading}
          emptyMessage="Nenhuma conta de cliente cadastrada"
          getRowTestId={(account) => `row-account-${account.id}`}
        />
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? "Editar Conta" : "Nova Conta de Cliente"}
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? "Atualize os dados de acesso e câmeras disponíveis"
                : "Defina os dados de acesso e quais câmeras o cliente poderá ver"}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-auto pr-1">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 px-1">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do cliente" {...field} data-testid="input-account-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail de acesso</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="email@cliente.com" {...field} data-testid="input-account-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="senha"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {editingAccount ? "Nova senha (deixe em branco para manter)" : "Senha inicial"}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder={editingAccount ? "••••••••" : "Mínimo 6 caracteres"}
                            {...field}
                            data-testid="input-account-password"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="clienteId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cliente</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-account-client">
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">— Nenhum —</SelectItem>
                            {clients?.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-account-status">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ativo">Ativo</SelectItem>
                            <SelectItem value="inativo">Inativo</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-sm font-medium">Câmeras visíveis</FormLabel>
                    {selectedCameraIds.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {selectedCameraIds.length} selecionada{selectedCameraIds.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>

                  {!cameras || cameras.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      Nenhuma câmera cadastrada ainda.
                    </p>
                  ) : (
                    <div className="space-y-4 max-h-56 overflow-y-auto rounded-md border p-3">
                      {Object.entries(groupedCameras || {}).map(([locName, group]) => (
                        <div key={locName} className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {group.locationName}
                          </p>
                          {group.cameras.map((cam) => (
                            <label
                              key={cam.id}
                              className="flex items-center gap-3 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent/50 transition-colors"
                              data-testid={`checkbox-camera-${cam.id}`}
                            >
                              <Checkbox
                                checked={selectedCameraIds.includes(cam.id)}
                                onCheckedChange={() => toggleCamera(cam.id)}
                                id={`cam-${cam.id}`}
                              />
                              <div className="flex items-center gap-2 flex-1">
                                <Camera className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-sm">{cam.nome}</span>
                                {cam.marca && (
                                  <span className="text-xs text-muted-foreground">({cam.marca})</span>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={handleCloseDialog}>
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-account"
                  >
                    {createMutation.isPending || updateMutation.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </form>
            </Form>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
