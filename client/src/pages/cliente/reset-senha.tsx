import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const schema = z
  .object({
    novaSenha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirmarSenha: z.string().min(1, "Confirme a nova senha"),
  })
  .refine((d) => d.novaSenha === d.confirmarSenha, {
    message: "As senhas não coincidem",
    path: ["confirmarSenha"],
  });

type FormValues = z.infer<typeof schema>;

export default function ResetSenhaPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showNova, setShowNova] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [done, setDone] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);

  // Extract token from URL query string
  const token = new URLSearchParams(window.location.search).get("token");

  useEffect(() => {
    if (!token) setTokenInvalid(true);
  }, [token]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { novaSenha: "", confirmarSenha: "" },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      apiRequest("POST", "/api/client/reset-password", {
        token,
        novaSenha: data.novaSenha,
      }),
    onSuccess: () => {
      setDone(true);
    },
    onError: (err: any) => {
      const msg = err?.message || "Erro ao redefinir senha";
      if (msg.includes("inválido") || msg.includes("expirado")) {
        setTokenInvalid(true);
      } else {
        toast({ title: "Erro", description: msg, variant: "destructive" });
      }
    },
  });

  return (
    <div className="min-h-screen bg-zinc-950 dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-700 to-blue-500 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <KeyRound className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-base">Redefinir senha</h2>
                <p className="text-blue-100 text-xs">SkyLapse — Portal do Cliente</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-6">
            {tokenInvalid ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <AlertCircle className="h-12 w-12 text-red-400" />
                <div>
                  <p className="text-white font-semibold">Link inválido ou expirado</p>
                  <p className="text-zinc-400 text-sm mt-1">
                    Solicite um novo link de redefinição de senha.
                  </p>
                </div>
                <Button
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                  onClick={() => navigate("/login")}
                >
                  Voltar ao login
                </Button>
              </div>
            ) : done ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                <div>
                  <p className="text-white font-semibold">Senha redefinida!</p>
                  <p className="text-zinc-400 text-sm mt-1">
                    Sua nova senha já está ativa. Faça login para continuar.
                  </p>
                </div>
                <Button
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                  onClick={() => navigate("/login")}
                >
                  Ir para o login
                </Button>
              </div>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="novaSenha"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-sm">Nova senha</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              {...field}
                              type={showNova ? "text" : "password"}
                              placeholder="Mínimo 8 caracteres"
                              className="bg-zinc-800 border-zinc-700 text-white pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNova(!showNova)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                            >
                              {showNova ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="confirmarSenha"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-sm">Confirmar nova senha</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              {...field}
                              type={showConfirmar ? "text" : "password"}
                              placeholder="Repita a nova senha"
                              className="bg-zinc-800 border-zinc-700 text-white pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmar(!showConfirmar)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                            >
                              {showConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold mt-2"
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? "Salvando..." : "Salvar nova senha"}
                  </Button>
                </form>
              </Form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
