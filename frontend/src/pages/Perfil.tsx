import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { Area } from "react-easy-crop";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/ui/Avatar";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../components/ui/Toast";
import { ModalCropAvatar } from "../components/perfil/ModalCropAvatar";
import { recortarERedimensionar } from "../lib/cropImage";

const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

function EyeIcon({ aberto }: { aberto: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {aberto ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-3.35 2.9A9.12 9.12 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 4.22-5.94" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <path d="M1 1l22 22" />
        </>
      )}
    </svg>
  );
}

function CampoSenha({
  id,
  label,
  value,
  onChange,
  erro,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  erro?: string | null;
  autoComplete: string;
}) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11.5px] text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visivel ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-md border bg-surface px-3 py-2 pr-10 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            erro ? "border-destructive" : "border-border"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <EyeIcon aberto={visivel} />
        </button>
      </div>
      {erro && <p className="mt-1 text-[11.5px] text-destructive">{erro}</p>}
    </div>
  );
}

export function Perfil() {
  const { user, atualizarUsuario } = useAuth();
  const { mostrar } = useToast();

  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [salvandoNome, setSalvandoNome] = useState(false);

  const [erroAvatar, setErroAvatar] = useState<string | null>(null);
  const [imagemParaCrop, setImagemParaCrop] = useState<string | null>(null);
  const [cropAberto, setCropAberto] = useState(false);
  const [enviandoAvatar, setEnviandoAvatar] = useState(false);
  const [removendoAvatar, setRemovendoAvatar] = useState(false);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState("");
  const [errosSenha, setErrosSenha] = useState<{ senhaAtual?: string; novaSenha?: string; confirmarNovaSenha?: string }>({});
  const [alterandoSenha, setAlterandoSenha] = useState(false);

  useEffect(() => {
    axios
      .get("/api/perfil")
      .then(({ data }) => {
        setNome(data.nome);
        setEmail(data.email);
        setFotoUrl(data.fotoUrl);
      })
      .catch(() => mostrar("Falha ao carregar seus dados", "destructive"))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErroAvatar(null);
    if (!TIPOS_ACEITOS.includes(file.type)) {
      setErroAvatar("Formato não suportado — envie jpg, png ou webp");
      return;
    }
    if (file.size > TAMANHO_MAXIMO) {
      setErroAvatar("A imagem precisa ter no máximo 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagemParaCrop(reader.result as string);
      setCropAberto(true);
    };
    reader.readAsDataURL(file);
  }

  async function onConfirmarCrop(area: Area) {
    if (!imagemParaCrop) return;
    setEnviandoAvatar(true);
    try {
      const blob = await recortarERedimensionar(imagemParaCrop, area, 256);
      const formData = new FormData();
      formData.append("avatar", blob, "avatar.webp");
      const { data } = await axios.post("/api/perfil/avatar", formData);
      setFotoUrl(data.fotoUrl);
      atualizarUsuario({ fotoUrl: data.fotoUrl });
      setCropAberto(false);
      setImagemParaCrop(null);
      mostrar("Foto atualizada", "success");
    } catch (err: any) {
      mostrar(err.response?.data?.error ?? "Falha ao enviar a foto", "destructive");
    } finally {
      setEnviandoAvatar(false);
    }
  }

  async function removerAvatar() {
    setRemovendoAvatar(true);
    try {
      await axios.delete("/api/perfil/avatar");
      setFotoUrl(null);
      atualizarUsuario({ fotoUrl: null });
      mostrar("Foto removida", "success");
    } catch (err: any) {
      mostrar(err.response?.data?.error ?? "Falha ao remover a foto", "destructive");
    } finally {
      setRemovendoAvatar(false);
    }
  }

  async function salvarNome() {
    setSalvandoNome(true);
    try {
      const { data } = await axios.put("/api/perfil", { nome });
      setNome(data.nome);
      atualizarUsuario({ nome: data.nome });
      mostrar("Dados atualizados", "success");
    } catch (err: any) {
      mostrar(err.response?.data?.error ?? "Falha ao salvar", "destructive");
    } finally {
      setSalvandoNome(false);
    }
  }

  function validarSenha(): boolean {
    const erros: typeof errosSenha = {};
    const forte = novaSenha.length >= 8 && /[A-Za-z]/.test(novaSenha) && /[0-9]/.test(novaSenha);
    if (!forte) erros.novaSenha = "A senha precisa ter pelo menos 8 caracteres, com letras e números";
    else if (novaSenha === senhaAtual) erros.novaSenha = "A nova senha precisa ser diferente da senha atual";
    if (confirmarNovaSenha !== novaSenha) erros.confirmarNovaSenha = "As senhas não coincidem";
    setErrosSenha(erros);
    return Object.keys(erros).length === 0;
  }

  async function alterarSenha() {
    if (!validarSenha()) return;
    setAlterandoSenha(true);
    try {
      await axios.post("/api/perfil/senha", { senhaAtual, novaSenha });
      mostrar("Senha alterada", "success");
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarNovaSenha("");
      setErrosSenha({});
    } catch (err: any) {
      if (err.response?.status === 401) {
        setErrosSenha({ senhaAtual: err.response.data?.error ?? "Senha atual incorreta" });
      } else {
        mostrar(err.response?.data?.error ?? "Falha ao alterar a senha", "destructive");
      }
    } finally {
      setAlterandoSenha(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Minha conta</p>
      <h1 className="mb-6 font-display text-2xl font-bold text-foreground">Meu perfil</h1>

      {carregando ? (
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-surface p-6">
            <h2 className="mb-4 font-display text-base font-semibold text-foreground">Dados pessoais</h2>

            <div className="mb-5 flex items-center gap-4">
              <Avatar nome={nome || user?.nome || ""} fotoUrl={fotoUrl} size="xl" />
              <div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => inputArquivoRef.current?.click()}
                    disabled={enviandoAvatar}
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Alterar foto
                  </button>
                  {fotoUrl && (
                    <button
                      type="button"
                      onClick={removerAvatar}
                      disabled={removendoAvatar}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {removendoAvatar ? "Removendo..." : "Remover"}
                    </button>
                  )}
                </div>
                <input
                  ref={inputArquivoRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={onSelecionarArquivo}
                />
                <p className="mt-1.5 text-[11px] text-muted">JPG, PNG ou WEBP — máximo 5MB</p>
                {erroAvatar && <p className="mt-1 text-[11.5px] text-destructive">{erroAvatar}</p>}
              </div>
            </div>

            <div className="max-w-sm">
              <label htmlFor="nome" className="mb-1 block text-[11.5px] text-muted">
                Nome de exibição
              </label>
              <input
                id="nome"
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-1 text-[11px] text-muted">{email}</p>
            </div>

            <div className="mt-5">
              <button
                type="button"
                onClick={salvarNome}
                disabled={salvandoNome || !nome.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {salvandoNome ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface p-6">
            <h2 className="mb-1 font-display text-base font-semibold text-foreground">Segurança</h2>
            <p className="mb-4 text-[12.5px] text-muted">Troque sua senha de acesso.</p>

            <div className="max-w-sm space-y-3">
              <CampoSenha
                id="senha-atual"
                label="Senha atual"
                value={senhaAtual}
                onChange={(v) => {
                  setSenhaAtual(v);
                  if (errosSenha.senhaAtual) setErrosSenha((atual) => ({ ...atual, senhaAtual: undefined }));
                }}
                erro={errosSenha.senhaAtual}
                autoComplete="current-password"
              />
              <CampoSenha
                id="nova-senha"
                label="Nova senha"
                value={novaSenha}
                onChange={setNovaSenha}
                erro={errosSenha.novaSenha}
                autoComplete="new-password"
              />
              <CampoSenha
                id="confirmar-nova-senha"
                label="Confirmar nova senha"
                value={confirmarNovaSenha}
                onChange={setConfirmarNovaSenha}
                erro={errosSenha.confirmarNovaSenha}
                autoComplete="new-password"
              />
            </div>

            <div className="mt-5">
              <button
                type="button"
                onClick={alterarSenha}
                disabled={alterandoSenha || !senhaAtual || !novaSenha || !confirmarNovaSenha}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {alterandoSenha ? "Alterando..." : "Alterar senha"}
              </button>
            </div>
          </section>
        </div>
      )}

      <ModalCropAvatar
        open={cropAberto}
        imageSrc={imagemParaCrop}
        onClose={() => {
          setCropAberto(false);
          setImagemParaCrop(null);
        }}
        onConfirm={onConfirmarCrop}
        confirmando={enviandoAvatar}
      />
    </div>
  );
}
