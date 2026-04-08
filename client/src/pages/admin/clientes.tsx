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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import type { Client } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const clientFormSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  email: z.string().email("Email inválido"),
  telefone: z.string().optional(),
  empresa: z.string().optional(),
});

type ClientFormValues = z.infer<typeof clientFormSchema>;

export default function ClientesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const { toast } = useToast();

  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/admin/clients"],
  });

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      nome: "",
      email: "",
      telefone: "",
      empresa: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ClientFormValues) => {
      return apiRequest("POST", "/api/admin/clients", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Cliente adicionado com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao adicionar cliente", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: ClientFormValues & { id: string }) => {
      return apiRequest("PUT", `/api/admin/clients/${data.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] });
      toast({ title: "Cliente atualizado com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar cliente", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/clients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Cliente removido com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao remover cliente", variant: "destructive" });
    },
  });

  const handleOpenDialog = (client?: Client) => {
    if (client) {
      setEditingClient(client);
      form.reset({
        nome: client.nome,
        email: client.email,
        telefone: client.telefone || "",
        empresa: client.empresa || "",
      });
    } else {
      setEditingClient(null);
      form.reset({
        nome: "",
        email: "",
        telefone: "",
        empresa: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingClient(null);
    form.reset();
  };

  const onSubmit = (data: ClientFormValues) => {
    if (editingClient) {
      updateMutation.mutate({ ...data, id: editingClient.id });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = [
    {
      key: "nome",
      header: "Nome",
      cell: (client: Client) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-medium">{client.nome}</p>
            <p className="text-xs text-muted-foreground">{client.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "empresa",
      header: "Empresa",
      cell: (client: Client) => client.empresa || "-",
    },
    {
      key: "telefone",
      header: "Telefone",
      cell: (client: Client) => client.telefone || "-",
    },
    {
      key: "status",
      header: "Status",
      cell: (client: Client) => (
        <StatusBadge status={client.status as "ativo" | "inativo"} />
      ),
    },
    {
      key: "createdAt",
      header: "Cadastro",
      cell: (client: Client) =>
        client.createdAt
          ? formatDistanceToNow(new Date(client.createdAt), {
              addSuffix: true,
              locale: ptBR,
            })
          : "-",
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      cell: (client: Client) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDialog(client);
            }}
            data-testid={`button-edit-client-${client.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Tem certeza que deseja remover este cliente?")) {
                deleteMutation.mutate(client.id);
              }
            }}
            data-testid={`button-delete-client-${client.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout title="Clientes">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-300">
            Gerencie os clientes da plataforma
          </p>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()} data-testid="button-add-client">
                <Plus className="mr-2 h-4 w-4" />
                Novo Cliente
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingClient ? "Editar Cliente" : "Adicionar Cliente"}
                </DialogTitle>
                <DialogDescription>
                  {editingClient
                    ? "Atualize as informações do cliente"
                    : "Preencha os dados do novo cliente"}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="nome"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Nome do cliente"
                            {...field}
                            data-testid="input-client-name"
                          />
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
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="email@exemplo.com"
                            {...field}
                            data-testid="input-client-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="telefone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telefone</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="(11) 99999-9999"
                              {...field}
                              data-testid="input-client-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="empresa"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Empresa</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Nome da empresa"
                              {...field}
                              data-testid="input-client-company"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCloseDialog}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-client"
                    >
                      {createMutation.isPending || updateMutation.isPending
                        ? "Salvando..."
                        : "Salvar"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <DataTable
          columns={columns}
          data={clients || []}
          isLoading={isLoading}
          emptyMessage="Nenhum cliente cadastrado"
          getRowTestId={(client) => `row-client-${client.id}`}
        />
      </div>
    </AdminLayout>
  );
}
