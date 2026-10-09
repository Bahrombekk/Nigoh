/* player/usePlayer.ts — React'da video pleyer (player.js ustida).
   const p = usePlayer(camera, { quality: "sub" | "" , enabled });
   <div className="mp-video"><video ref={p.videoRef} muted playsInline/><span ref={p.msgRef}/></div>
   p.status: "idle" | "wait" | "playing" | "fail";  p.openMs — ochilish vaqti; p.retry().
   Kamera yoki sifat o'zgarsa oqim qayta ochiladi; komponent yopilsa to'xtaydi. */
import { useEffect, useRef, useState } from "react";
import { createPlayer } from "./player.js";
import { HEVC_OK } from "./env.js";
import type { Camera } from "@/lib/types";

type Status = "idle" | "wait" | "playing" | "fail";
interface PlayerLike {
  open: (cam: unknown, useHevc: boolean, quality?: string) => void;
  stop: () => void;
  retry: () => void;
  onOpen: ((ms: number, mode: string) => void) | null;
  onState: ((kind: string, text: string) => void) | null;
}

export function usePlayer(cam: Camera | null | undefined, opts: { quality?: "" | "sub"; enabled?: boolean } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const msgRef = useRef<HTMLSpanElement>(null);
  const player = useRef<PlayerLike | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [openMs, setOpenMs] = useState<number | null>(null);
  const enabled = opts.enabled !== false;
  const quality = opts.quality || "";

  useEffect(() => {
    if (!videoRef.current || !msgRef.current) return;
    const p = createPlayer(videoRef.current, msgRef.current) as PlayerLike;
    p.onOpen = (ms) => { setOpenMs(ms); setStatus("playing"); };
    p.onState = (kind, text) => {
      setMessage(text || "");
      if (kind === "wait") setStatus("wait");
      else if (kind === "fail") setStatus("fail");
    };
    player.current = p;
    return () => { p.stop(); player.current = null; };
  }, []);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (!cam || !enabled) { p.stop(); setStatus("idle"); return; }
    setOpenMs(null);
    setStatus("wait");
    p.open(cam, HEVC_OK, quality);
  }, [cam?.id, enabled, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  return { videoRef, msgRef, status, message, openMs, retry: () => player.current?.retry(), stop: () => player.current?.stop() };
}
