import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";

// Dados mockados só para validar o layout — serão substituídos pelos dados
// reais sincronizados via API SOAP (Senior ERP) assim que as queries e as
// tabelas de negócio forem definidas.
const BUCKETS = [
  { key: "aVencer", label: "A vencer", pct: 46, valor: "184.220,00", tom: "ledger" },
  { key: "d1_30", label: "1–30 dias", pct: 27, valor: "108.150,00", tom: "amber" },
  { key: "d31_60", label: "31–60 dias", pct: 16, valor: "64.080,00", tom: "amber" },
  { key: "d60", label: "60+ dias", pct: 11, valor: "44.055,00", tom: "rust" },
] as const;

const TITULOS = [
  { cli: "Industrial Rex Ltda", doc: "NF 18.442 · 3/4", venc: "18/07/2026", valor: "24.800,00", st: "A vencer", tom: "ledger" },
  { cli: "Soeltech Sistemas", doc: "NF 18.401 · 1/1", venc: "02/07/2026", valor: "12.350,00", st: "11 dias", tom: "amber" },
  { cli: "Metalúrgica Trombudo", doc: "NF 18.377 · 2/3", venc: "14/06/2026", valor: "38.900,00", st: "29 dias", tom: "amber" },
  { cli: "Polividros Comércio", doc: "NF 18.290 · 1/2", venc: "03/05/2026", valor: "44.055,00", st: "71 dias", tom: "rust" },
  { cli: "Cerâmica Alto Vale", doc: "NF 18.455 · 1/1", venc: "29/07/2026", valor: "9.640,00", st: "A vencer", tom: "ledger" },
] as const;

const c = (tom: string) => `var(--${tom})`;
const cbg = (tom: string) => `var(--${tom}-bg)`;

export function Dashboard() {
  const { logout } = useAuth();

  return (
    <PageShell>
      <header className="head">
        <div>
          <p className="eyebrow">Contas a receber · Senior ERP</p>
          <h1 className="display">Carteira em aberto</h1>
          <p>Dados de exemplo — a sincronização real com o Senior ERP ainda será conectada.</p>
        </div>
        <button className="btn-ghost" onClick={logout}>
          Sair
        </button>
      </header>

      <div className="kpis">
        <div className="kpi">
          <p className="label">Total em aberto</p>
          <span className="value money">R$ 400.505,00</span>
          <p className="sub">
            <span className="dot" style={{ background: c("ink-faint") }} />
            142 títulos · 38 clientes
          </p>
        </div>
        <div className="kpi">
          <p className="label">Vencido</p>
          <span className="value money" style={{ color: c("rust") }}>
            R$ 216.285,00
          </span>
          <p className="sub">
            <span className="dot" style={{ background: c("rust") }} />
            54% da carteira
          </p>
        </div>
        <div className="kpi">
          <p className="label">Prazo médio de recebimento</p>
          <span className="value money">41 dias</span>
          <p className="sub">
            <span className="dot" style={{ background: c("amber") }} />
            +6 dias vs. mês anterior
          </p>
        </div>
      </div>

      <section className="spine-card">
        <p className="eyebrow">Aging da carteira</p>
        <div className="spine" role="img" aria-label="Distribuição da carteira por faixa de vencimento">
          {BUCKETS.map((b) => (
            <div
              key={b.key}
              className="seg"
              style={{ width: `${b.pct}%`, background: c(b.tom) }}
              title={`${b.label} — R$ ${b.valor}`}
            />
          ))}
        </div>
        <div className="legend">
          {BUCKETS.map((b) => (
            <div className="leg" key={b.key}>
              <span className="bar" style={{ background: c(b.tom) }} />
              <span>
                <span className="n money">R$ {b.valor}</span>
                <span className="t">
                  {b.label} · {b.pct}%
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="tbl-card">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th className="doc-col">Vencimento</th>
              <th className="r">Valor</th>
              <th className="r">Situação</th>
            </tr>
          </thead>
          <tbody>
            {TITULOS.map((t) => (
              <tr key={t.doc}>
                <td>
                  <div className="cli">{t.cli}</div>
                  <div className="doc money">{t.doc}</div>
                </td>
                <td className="doc-col money" style={{ color: "var(--ink-soft)" }}>
                  {t.venc}
                </td>
                <td className="r money" style={{ fontWeight: 600 }}>
                  R$ {t.valor}
                </td>
                <td className="r">
                  <span className="tag" style={{ color: c(t.tom), background: cbg(t.tom) }}>
                    {t.st}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
