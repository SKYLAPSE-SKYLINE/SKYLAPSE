import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Ticket = {
  id: string;
  clientAccountId: string;
  assunto: string;
  categoria: string;
  prioridade: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  clientAccount?: { id: string; nome: string; email: string } | null;
};

type Message = {
  id: string;
  ticketId: string;
  autorTipo: "cliente" | "admin";
  autorNome: string;
  mensagem: string;
  createdAt: string;
};

type TicketDetail = Ticket & { messages: Message[] };

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  aberto: { label: "Aberto", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  em_andamento: { label: "Em andamento", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  resolvido: { label: "Resolvido", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  fechado: { label: "Fechado", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const CATEGORIA_LABEL: Record<string, string> = {
  camera: "Câmera",
  conta: "Conta",
  duvida: "Dúvida",
  outro: "Outro",
};

const PRIORIDADE_COLOR: Record<string, string> = {
  baixa: "border-zinc-700 text-zinc-400",
  media: "border-blue-500/30 text-blue-400",
  alta: "border-red-500/30 text-red-400",
};

export default function AdminSuporte() {
  const [filter, setFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryKey = filter === "all" ? ["/api/admin/tickets"] : [`/api/admin/tickets?status=${filter}`];
  const { data: tickets, isLoading } = useQuery<Ticket[]>({ queryKey });

  return (
    <AdminLayout title="Suporte">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Tickets de suporte</h1>
        <p className="text-sm text-zinc-500 mt-1">Solicitações recebidas dos clientes.</p>
      </div>

      <Tabs value={filter} onValueChange={setFilter} className="mb-6">
        <TabsList>
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="aberto">Abertos</TabsTrigger>
          <TabsTrigger value="em_andamento">Em andamento</TabsTrigger>
          <TabsTrigger value="resolvido">Resolvidos</TabsTrigger>
          <TabsTrigger value="fechado">Fechados</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="text-zinc-500 text-sm">Carregando...</div>
      ) : !tickets || tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
            <MessageSquare className="h-7 w-7 text-zinc-600" />
          </div>
          <p className="text-white font-medium">Nenhum ticket</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/50 text-left text-zinc-400 text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">Assunto</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Prioridade</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className="border-t border-zinc-800/50 hover:bg-zinc-900/50 cursor-pointer"
                  data-testid={`ticket-row-${t.id}`}
                >
                  <td className="px-4 py-3 text-white font-medium">{t.assunto}</td>
                  <td className="px-4 py-3 text-zinc-400">{t.clientAccount?.nome || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                      {CATEGORIA_LABEL[t.categoria] || t.categoria}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[10px] ${PRIORIDADE_COLOR[t.prioridade] || ""}`}>
                      {t.prioridade}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_LABEL[t.status]?.color || ""}`}>
                      {STATUS_LABEL[t.status]?.label || t.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true, locale: ptBR })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTicketDialog ticketId={selectedId} onClose={() => setSelectedId(null)} />
    </AdminLayout>
  );
}

function AdminTicketDialog({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");

  const { data: ticket, isLoading } = useQuery<TicketDetail>({
    queryKey: ["/api/admin/tickets", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!ticketId,
    refetchInterval: ticketId ? 15_000 : false,
  });

  const replyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/admin/tickets/${ticketId}/messages`, { mensagem: reply }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets/count-open"] });
      setReply("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: (patch: { status?: string; prioridade?: string }) =>
      apiRequest("PATCH", `/api/admin/tickets/${ticketId}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets/count-open"] });
      toast({ title: "Ticket atualizado" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={!!ticketId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-zinc-800">
        {isLoading || !ticket ? (
          <div className="text-zinc-500 text-sm py-8 text-center">Carregando...</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-white">{ticket.assunto}</DialogTitle>
              <p className="text-xs text-zinc-500">
                Cliente: {ticket.clientAccount?.nome || "—"} ({ticket.clientAccount?.email || "—"})
              </p>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 py-2 border-y border-zinc-800/50">
              <div>
                <label className="text-[10px] uppercase text-zinc-500 tracking-wider">Status</label>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => patchMutation.mutate({ status: v })}
                >
                  <SelectTrigger className="mt-1" data-testid="select-admin-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aberto">Aberto</SelectItem>
                    <SelectItem value="em_andamento">Em andamento</SelectItem>
                    <SelectItem value="resolvido">Resolvido</SelectItem>
                    <SelectItem value="fechado">Fechado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-zinc-500 tracking-wider">Prioridade</label>
                <Select
                  value={ticket.prioridade}
                  onValueChange={(v) => patchMutation.mutate({ prioridade: v })}
                >
                  <SelectTrigger className="mt-1" data-testid="select-admin-prioridade"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="media">Média</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="max-h-[45vh] overflow-y-auto space-y-3 pr-2">
              {ticket.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg p-3 ${
                    m.autorTipo === "admin"
                      ? "bg-blue-600/10 border border-blue-600/20 ml-8"
                      : "bg-zinc-900 border border-zinc-800 mr-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-white">
                      {m.autorNome} {m.autorTipo === "admin" && <span className="text-blue-400">(Você/Admin)</span>}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{m.mensagem}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-zinc-800">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={2}
                placeholder="Responder ao cliente..."
                className="flex-1"
                data-testid="textarea-admin-reply"
              />
              <Button
                onClick={() => replyMutation.mutate()}
                disabled={replyMutation.isPending || reply.length < 1}
                className="bg-blue-600 hover:bg-blue-500 self-end"
                data-testid="button-admin-send-reply"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
