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
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, MapPin, Camera } from "lucide-react";
import type { Location, Client, LocationWithClient } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { brazilStates, getCitiesByState } from "@/lib/brazil-data";

const locationFormSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  endereco: z.string().optional(),
  estado: z.string().min(1, "Selecione um estado"),
  cidade: z.string().min(1, "Selecione uma cidade"),
  descricao: z.string().optional(),
  clienteId: z.string().min(1, "Selecione um cliente"),
});

type LocationFormValues = z.infer<typeof locationFormSchema>;

export default function LocalidadesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const { toast } = useToast();

  const { data: locations, isLoading } = useQuery<LocationWithClient[]>({
    queryKey: ["/api/admin/locations"],
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/admin/clients"],
  });

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      nome: "",
      endereco: "",
      estado: "",
      cidade: "",
      descricao: "",
      clienteId: "",
    },
  });

  const selectedEstado = form.watch("estado");
  const availableCities = selectedEstado ? getCitiesByState(selectedEstado) : [];

  const createMutation = useMutation({
    mutationFn: async (data: LocationFormValues) => {
      return apiRequest("POST", "/api/admin/locations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      toast({ title: "Localidade adicionada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao adicionar localidade", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: LocationFormValues & { id: string }) => {
      return apiRequest("PUT", `/api/admin/locations/${data.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      toast({ title: "Localidade atualizada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar localidade", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      toast({ title: "Localidade removida com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao remover localidade", variant: "destructive" });
    },
  });

  const handleOpenDialog = (location?: Location) => {
    if (location) {
      setEditingLocation(location);
      form.reset({
        nome: location.nome,
        endereco: location.endereco || "",
        estado: location.estado || "",
        cidade: location.cidade || "",
        descricao: location.descricao || "",
        clienteId: location.clienteId || "",
      });
    } else {
      setEditingLocation(null);
      form.reset({
        nome: "",
        endereco: "",
        estado: "",
        cidade: "",
        descricao: "",
        clienteId: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingLocation(null);
    form.reset();
  };

  const onSubmit = (data: LocationFormValues) => {
    if (editingLocation) {
      updateMutation.mutate({ ...data, id: editingLocation.id });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = [
    {
      key: "nome",
      header: "Localidade",
      cell: (location: LocationWithClient) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500/10">
            <MapPin className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <p className="font-medium">{location.nome}</p>
            <p className="text-xs text-muted-foreground">
              {location.cidade && location.estado
                ? `${location.cidade}, ${location.estado}`
                : location.endereco || "Localização não informada"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "cliente",
      header: "Cliente",
      cell: (location: LocationWithClient) =>
        location.cliente?.nome || "-",
    },
    {
      key: "status",
      header: "Status",
      cell: (location: LocationWithClient) => (
        <StatusBadge status={location.status as "ativo" | "inativo"} />
      ),
    },
    {
      key: "createdAt",
      header: "Cadastro",
      cell: (location: LocationWithClient) =>
        location.createdAt
          ? formatDistanceToNow(new Date(location.createdAt), {
              addSuffix: true,
              locale: ptBR,
            })
          : "-",
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      cell: (location: LocationWithClient) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDialog(location);
            }}
            data-testid={`button-edit-location-${location.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Tem certeza que deseja remover esta localidade?")) {
                deleteMutation.mutate(location.id);
              }
            }}
            data-testid={`button-delete-location-${location.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout title="Localidades">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-300">
            Gerencie as localidades de monitoramento
          </p>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()} data-testid="button-add-location">
                <Plus className="mr-2 h-4 w-4" />
                Nova Localidade
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingLocation ? "Editar Localidade" : "Adicionar Localidade"}
                </DialogTitle>
                <DialogDescription>
                  {editingLocation
                    ? "Atualize as informações da localidade"
                    : "Preencha os dados da nova localidade"}
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
                            placeholder="Nome da localidade"
                            {...field}
                            data-testid="input-location-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="clienteId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cliente</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-location-client">
                              <SelectValue placeholder="Selecione um cliente" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {clients?.map((client) => (
                              <SelectItem key={client.id} value={client.id}>
                                {client.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="estado"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Estado</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              field.onChange(value);
                              form.setValue("cidade", "");
                            }}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-location-state">
                                <SelectValue placeholder="Selecione o estado" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {brazilStates.map((state) => (
                                <SelectItem key={state.sigla} value={state.sigla}>
                                  {state.nome} ({state.sigla})
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
                      name="cidade"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cidade</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={!selectedEstado}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-location-city">
                                <SelectValue placeholder={selectedEstado ? "Selecione a cidade" : "Selecione o estado primeiro"} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableCities.map((city) => (
                                <SelectItem key={city} value={city}>
                                  {city}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="endereco"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endereço</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Rua, número, bairro..."
                            {...field}
                            data-testid="input-location-address"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="descricao"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descrição</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Descrição da localidade"
                            {...field}
                            data-testid="input-location-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                      data-testid="button-save-location"
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
          data={locations || []}
          isLoading={isLoading}
          emptyMessage="Nenhuma localidade cadastrada"
          getRowTestId={(location) => `row-location-${location.id}`}
        />
      </div>
    </AdminLayout>
  );
}
