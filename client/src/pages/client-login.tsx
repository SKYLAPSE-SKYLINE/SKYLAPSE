import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Eye, EyeOff, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const loginSchema = z.object({
  email: z.string().email("E-mail invalido"),
  senha: z.string().min(1, "Senha obrigatoria"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const forgotSchema = z.object({
  email: z.string().email("E-mail inválido"),
});
type ForgotFormValues = z.infer<typeof forgotSchema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const forgotForm = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const forgotMutation = useMutation({
    mutationFn: (data: ForgotFormValues) =>
      apiRequest("POST", "/api/client/forgot-password", { email: data.email }),
    onSuccess: () => setForgotSent(true),
    onError: () => {
      // Always show success to avoid email enumeration
      setForgotSent(true);
    },
  });

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", senha: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormValues) => {
      const adminRes = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (adminRes.ok) {
        const user = await adminRes.json();
        return { role: "admin" as const, user };
      }
      if (adminRes.status !== 401) {
        const err = await adminRes.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Erro ao fazer login");
      }
      const clientRes = await fetch("/api/client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (clientRes.ok) {
        const user = await clientRes.json();
        return { role: "client" as const, user };
      }
      const err = await clientRes.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message || "E-mail ou senha incorretos");
    },
    onSuccess: ({ role }) => {
      queryClient.clear();
      navigate(role === "admin" ? "/admin/dashboard" : "/cliente/dashboard");
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Erro ao fazer login", variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen flex bg-black dark">
      {/* Left — branding panel */}
      <div className="hidden lg:flex lg:w-1/2 relative items-end p-12 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 overflow-hidden">
        {/* Abstract grid pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-500/10 rounded-full blur-[100px]" />

        <div className="relative z-10 space-y-6">
          <div className="space-y-1">
            <p className="text-zinc-500 text-sm font-medium tracking-widest uppercase">Monitoramento</p>
            <h1 className="text-5xl font-bold text-white tracking-tight leading-[1.1]">
              Sky<span className="text-blue-400">Lapse</span>
            </h1>
          </div>
          <p className="text-zinc-400 text-lg max-w-sm leading-relaxed">
            Acompanhe a evolucao da sua obra com capturas automaticas e timelapses em alta resolucao.
          </p>
          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-2xl font-semibold text-white">4K</p>
              <p className="text-xs text-zinc-500 mt-0.5">Resolucao</p>
            </div>
            <div className="w-px bg-zinc-700" />
            <div>
              <p className="text-2xl font-semibold text-white">24/7</p>
              <p className="text-xs text-zinc-500 mt-0.5">Monitoramento</p>
            </div>
            <div className="w-px bg-zinc-700" />
            <div>
              <p className="text-2xl font-semibold text-white">Auto</p>
              <p className="text-xs text-zinc-500 mt-0.5">Timelapse</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-zinc-950">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden space-y-1">
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Sky<span className="text-blue-400">Lapse</span>
            </h1>
            <p className="text-zinc-500 text-sm">Monitoramento de obras</p>
          </div>

          {!forgotMode && (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">Acessar portal</h2>
              <p className="text-sm text-zinc-500">Entre com suas credenciais para continuar</p>
            </div>
          )}

          {forgotMode ? (
            <div className="space-y-5">
              {forgotSent ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                  <div>
                    <p className="text-white font-semibold text-sm">E-mail enviado!</p>
                    <p className="text-zinc-400 text-xs mt-1 leading-relaxed">
                      Se o endereço estiver cadastrado, você receberá um link para redefinir sua senha.
                    </p>
                  </div>
                  <button
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-1"
                    onClick={() => { setForgotMode(false); setForgotSent(false); forgotForm.reset(); }}
                  >
                    Voltar ao login
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Esqueci minha senha</h2>
                    <p className="text-sm text-zinc-500 mt-1">
                      Informe seu e-mail para receber o link de redefinição.
                    </p>
                  </div>
                  <Form {...forgotForm}>
                    <form
                      onSubmit={forgotForm.handleSubmit((d) => forgotMutation.mutate(d))}
                      className="space-y-4"
                    >
                      <FormField
                        control={forgotForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder="E-mail cadastrado"
                                autoComplete="email"
                                className="h-12 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-blue-500/40 focus-visible:border-zinc-600"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-medium"
                        disabled={forgotMutation.isPending}
                      >
                        {forgotMutation.isPending ? (
                          <span className="flex items-center gap-2">
                            <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Enviando...
                          </span>
                        ) : (
                          "Enviar link"
                        )}
                      </Button>
                    </form>
                  </Form>
                  <button
                    className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    onClick={() => setForgotMode(false)}
                  >
                    Voltar ao login
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => loginMutation.mutate(d))} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="E-mail"
                            autoComplete="email"
                            className="h-12 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-blue-500/40 focus-visible:border-zinc-600"
                            {...field}
                            data-testid="input-login-email"
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
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="Senha"
                              autoComplete="current-password"
                              className="h-12 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 pr-10 focus-visible:ring-blue-500/40 focus-visible:border-zinc-600"
                              {...field}
                              data-testid="input-login-password"
                            />
                            <button
                              type="button"
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs text-zinc-500 hover:text-blue-400 transition-colors"
                      onClick={() => setForgotMode(true)}
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                    disabled={loginMutation.isPending}
                    data-testid="button-login-submit"
                  >
                    {loginMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Entrando...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        Entrar
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </Button>
                </form>
              </Form>

              <p className="text-center text-xs text-zinc-600">
                Problemas para acessar? Entre em contato com o suporte.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
