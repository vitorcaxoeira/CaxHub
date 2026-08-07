// Conversores entre um instante ISO e os valores que <input type="date"> e
// <input type="time"> esperam.
//
// Os dois inputs falam HORA LOCAL do navegador — passar o ISO cru (UTC) preenche o campo
// com o horário deslocado. Como quem usa o CaxHub está no Brasil, o `new Date(iso)` local
// dá a hora de parede certa, que é a mesma convenção de RatItem.horini/horfim.
//
// Mora aqui porque a tela de Aprovações e a de Meus Apontamentos precisam da MESMA
// conversão nos formulários de ajuste de horário — duas cópias divergiriam no primeiro
// acerto.
const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** "2026-08-07" */
export function paraInputData(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/** "14:30" */
export function paraInputHora(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}
