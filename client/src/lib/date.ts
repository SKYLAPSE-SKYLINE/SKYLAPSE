import { formatInTimeZone } from "date-fns-tz";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const TZ = "America/Sao_Paulo";

/** Ex: 06/04 14:32 */
export function fmtShort(date: string | Date): string {
  return formatInTimeZone(new Date(date), TZ, "dd/MM HH:mm", { locale: ptBR });
}

/** Ex: 06 abr 2026, 14:32:09 */
export function fmtLong(date: string | Date): string {
  return formatInTimeZone(new Date(date), TZ, "dd MMM yyyy, HH:mm:ss", { locale: ptBR });
}

/** Ex: 2026-04-06_14-32-09  (para nomes de arquivo) */
export function fmtFilename(date: string | Date): string {
  return formatInTimeZone(new Date(date), TZ, "yyyy-MM-dd_HH-mm-ss");
}

/** Ex: "há 5 minutos" — sempre relativo a agora */
export function fmtRelative(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR });
}
