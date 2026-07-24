import { useState } from "react";
import Cropper, { Area, Point } from "react-easy-crop";
import { Modal } from "../ui/Modal";

interface ModalCropAvatarProps {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (area: Area) => void;
  confirmando?: boolean;
}

export function ModalCropAvatar({ open, imageSrc, onClose, onConfirm, confirmando = false }: ModalCropAvatarProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);

  function fechar() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaPixels(null);
    onClose();
  }

  function confirmar() {
    if (areaPixels) onConfirm(areaPixels);
  }

  return (
    <Modal open={open} onClose={fechar} title="Ajustar foto" subtitulo="Arraste para posicionar e use o zoom para ajustar">
      {imageSrc && (
        <div className="space-y-4">
          <div className="relative h-72 w-full overflow-hidden rounded-md bg-surface-2">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, areaEmPixels) => setAreaPixels(areaEmPixels)}
            />
          </div>

          <div>
            <label htmlFor="crop-zoom" className="mb-1 block text-[11.5px] text-muted">
              Zoom
            </label>
            <input
              id="crop-zoom"
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={fechar}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={!areaPixels || confirmando}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {confirmando ? "Salvando..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
