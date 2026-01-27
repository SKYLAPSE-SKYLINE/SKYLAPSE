import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { DataTable } from "@/components/data-table";
import { StatusBadge, StatusDot } from "@/components/status-badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Camera, 
  Eye, 
  Image, 
  TestTube2,
  CheckCircle,
  XCircle,
  Loader2
} from "lucide-react";
import type { Camera as CameraType, Location, CameraWithLocation } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const cameraFormSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  localidadeId: z.string().min(1, "Selecione uma localidade"),
  marca: z.enum(["reolink", "intelbras", "hikvision", "outra"]),
  modelo: z.string().optional(),
  hostname: z.string().min(1, "Hostname é obrigatório"),
  portaHttp: z.coerce.number().min(1).max(65535, "Porta deve ser entre 1 e 65535"),
  portaRtsp: z.coerce.number().min(1).max(65535).optional().nullable(),
  usuario: z.string().min(1, "Usuário é obrigatório"),
  senha: z.string().min(1, "Senha é obrigatória"),
  intervaloCaptura: z.coerce.number().default(15),
});

type CameraFormValues = z.infer<typeof cameraFormSchema>;

interface TestResult {
  sucesso: boolean;
  mensagem: string;
  imagem?: string;
}

export default function CamerasPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CameraType | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const { data: cameras, isLoading } = useQuery<CameraWithLocation[]>({
    queryKey: ["/api/admin/cameras"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/admin/locations"],
  });

  const form = useForm<CameraFormValues>({
    resolver: zodResolver(cameraFormSchema),
    defaultValues: {
      nome: "",
      localidadeId: "",
      marca: "reolink",
      modelo: "",
      hostname: "",
      portaHttp: 80,
      portaRtsp: undefined,
      usuario: "admin",
      senha: "",
      intervaloCaptura: 15,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CameraFormValues) => {
      return apiRequest("POST", "/api/admin/cameras", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Câmera adicionada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao adicionar câmera", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CameraFormValues & { id: string }) => {
      return apiRequest("PUT", `/api/admin/cameras/${data.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      toast({ title: "Câmera atualizada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar câmera", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/cameras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Câmera removida com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao remover câmera", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (data: Partial<CameraFormValues>) => {
      const response = await apiRequest("POST", "/api/admin/cameras/test", data);
      return response.json();
    },
    onSuccess: (data: TestResult) => {
      setTestResult(data);
    },
    onError: () => {
      setTestResult({
        sucesso: false,
        mensagem: "Erro ao testar conexão com a câmera",
      });
    },
  });

  const handleOpenDialog = (camera?: CameraType) => {
    setTestResult(null);
    if (camera) {
      setEditingCamera(camera);
      form.reset({
        nome: camera.nome,
        localidadeId: camera.localidadeId || "",
        marca: (camera.marca as "reolink" | "intelbras" | "hikvision" | "outra") || "reolink",
        modelo: camera.modelo || "",
        hostname: camera.hostname,
        portaHttp: camera.portaHttp,
        portaRtsp: camera.portaRtsp ?? undefined,
        usuario: camera.usuario,
        senha: camera.senha,
        intervaloCaptura: camera.intervaloCaptura,
      });
    } else {
      setEditingCamera(null);
      form.reset({
        nome: "",
        localidadeId: "",
        marca: "reolink",
        modelo: "",
        hostname: "",
        portaHttp: 80,
        portaRtsp: undefined,
        usuario: "admin",
        senha: "",
        intervaloCaptura: 15,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingCamera(null);
    setTestResult(null);
    setShowPassword(false);
    form.reset();
  };

  const handleTestConnection = () => {
    const values = form.getValues();
    testMutation.mutate({
      hostname: values.hostname,
      portaHttp: values.portaHttp,
      usuario: values.usuario,
      senha: values.senha,
      marca: values.marca,
    });
  };

  const onSubmit = (data: CameraFormValues) => {
    if (editingCamera) {
      updateMutation.mutate({ ...data, id: editingCamera.id });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = [
    {
      key: "nome",
      header: "Câmera",
      cell: (camera: CameraWithLocation) => (
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Camera className="h-5 w-5 text-primary" />
            </div>
            <StatusDot 
              status={camera.status as "online" | "offline"} 
              className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background"
            />
          </div>
          <div>
            <p className="font-medium">{camera.nome}</p>
            <p className="text-xs text-muted-foreground">
              {camera.localidade?.nome || "Sem localidade"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "marca",
      header: "Marca",
      cell: (camera: CameraWithLocation) => (
        <span className="capitalize">{camera.marca}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (camera: CameraWithLocation) => (
        <StatusBadge status={camera.status as "online" | "offline"} />
      ),
    },
    {
      key: "ultimaCaptura",
      header: "Última Captura",
      cell: (camera: CameraWithLocation) =>
        camera.ultimaCaptura
          ? formatDistanceToNow(new Date(camera.ultimaCaptura), {
              addSuffix: true,
              locale: ptBR,
            })
          : "Sem capturas",
    },
    {
      key: "actions",
      header: "",
      className: "w-36",
      cell: (camera: CameraWithLocation) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            asChild
            data-testid={`button-view-camera-${camera.id}`}
          >
            <Link href={`/admin/cameras/${camera.id}/live`}>
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            data-testid={`button-gallery-camera-${camera.id}`}
          >
            <Link href={`/admin/cameras/${camera.id}/galeria`}>
              <Image className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDialog(camera);
            }}
            data-testid={`button-edit-camera-${camera.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Tem certeza que deseja remover esta câmera?")) {
                deleteMutation.mutate(camera.id);
              }
            }}
            data-testid={`button-delete-camera-${camera.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout
      title="Câmeras"
      breadcrumbs={[
        { label: "Admin", href: "/admin/dashboard" },
        { label: "Câmeras" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">
            Gerencie as câmeras de monitoramento
          </p>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()} data-testid="button-add-camera">
                <Plus className="mr-2 h-4 w-4" />
                Nova Câmera
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editingCamera ? "Editar Câmera" : "Adicionar Nova Câmera"}
                </DialogTitle>
                <DialogDescription>
                  {editingCamera
                    ? "Atualize as configurações da câmera"
                    : "Configure uma nova câmera para monitoramento"}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Informações Básicas
                    </h3>
                    <FormField
                      control={form.control}
                      name="nome"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nome da Câmera</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Ex: Câmera Entrada Principal"
                              {...field}
                              data-testid="input-camera-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="localidadeId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Localidade</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-camera-location">
                                <SelectValue placeholder="Selecione uma localidade" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {locations?.map((location) => (
                                <SelectItem key={location.id} value={location.id}>
                                  {location.nome}
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
                      name="marca"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Marca</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              value={field.value}
                              className="flex flex-wrap gap-4"
                            >
                              {["reolink", "intelbras", "hikvision", "outra"].map((marca) => (
                                <div key={marca} className="flex items-center space-x-2">
                                  <RadioGroupItem value={marca} id={marca} />
                                  <Label htmlFor={marca} className="capitalize">
                                    {marca}
                                  </Label>
                                </div>
                              ))}
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="modelo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Modelo (opcional)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Ex: RLC-811A"
                              {...field}
                              data-testid="input-camera-model"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Configurações de Rede
                    </h3>
                    <FormField
                      control={form.control}
                      name="hostname"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Hostname / IP / NO-IP</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Ex: timelapse-sky.ddns.net"
                              {...field}
                              data-testid="input-camera-hostname"
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Apenas o endereço, sem http:// ou porta. Ex: cameras.ddns.net ou 192.168.1.100
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="portaHttp"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Porta HTTP</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="80"
                                {...field}
                                data-testid="input-camera-port-http"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="portaRtsp"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Porta RTSP (opcional)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="554"
                                {...field}
                                value={field.value ?? ""}
                                data-testid="input-camera-port-rtsp"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Credenciais
                    </h3>
                    <FormField
                      control={form.control}
                      name="usuario"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Usuário</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="admin"
                              {...field}
                              data-testid="input-camera-username"
                            />
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
                          <FormLabel>Senha</FormLabel>
                          <FormControl>
                            <div className="flex gap-2">
                              <Input
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                data-testid="input-camera-password"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Captura Automática
                    </h3>
                    <FormField
                      control={form.control}
                      name="intervaloCaptura"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Intervalo de Captura</FormLabel>
                          <Select
                            onValueChange={(val) => field.onChange(Number(val))}
                            value={String(field.value)}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-camera-interval">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="5">5 minutos</SelectItem>
                              <SelectItem value="10">10 minutos</SelectItem>
                              <SelectItem value="15">15 minutos</SelectItem>
                              <SelectItem value="30">30 minutos</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleTestConnection}
                    disabled={testMutation.isPending}
                    data-testid="button-test-connection"
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube2 className="mr-2 h-4 w-4" />
                    )}
                    Testar Conexão
                  </Button>

                  {testResult && (
                    <Card className={testResult.sucesso ? "border-green-500" : "border-destructive"}>
                      <CardContent className="flex items-center gap-3 p-4">
                        {testResult.sucesso ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                        <span className={testResult.sucesso ? "text-green-500" : "text-destructive"}>
                          {testResult.mensagem}
                        </span>
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={handleCloseDialog}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-camera"
                    >
                      {createMutation.isPending || updateMutation.isPending
                        ? "Salvando..."
                        : "Salvar Câmera"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <DataTable
          columns={columns}
          data={cameras || []}
          isLoading={isLoading}
          emptyMessage="Nenhuma câmera cadastrada"
          getRowTestId={(camera) => `row-camera-${camera.id}`}
        />
      </div>
    </AdminLayout>
  );
}
