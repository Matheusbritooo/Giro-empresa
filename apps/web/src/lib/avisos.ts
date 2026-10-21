"use client";

import { api } from "./api";

// Som do alerta: dois toques curtos gerados na hora, sem arquivo de áudio.
let audio: AudioContext | null = null;

export function prepararSom(): void {
  // Navegadores só liberam som depois de um toque na tela; chamamos isso no primeiro clique.
  audio ??= new AudioContext();
  if (audio.state === "suspended") void audio.resume();
}

export function tocarAlerta(): void {
  if (!audio || audio.state !== "running") return;
  const agora = audio.currentTime;
  for (const [inicio, frequencia] of [
    [0, 880],
    [0.22, 660],
  ] as const) {
    const oscilador = audio.createOscillator();
    const volume = audio.createGain();
    oscilador.frequency.value = frequencia;
    volume.gain.setValueAtTime(0.0001, agora + inicio);
    volume.gain.exponentialRampToValueAtTime(0.3, agora + inicio + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + 0.18);
    oscilador.connect(volume).connect(audio.destination);
    oscilador.start(agora + inicio);
    oscilador.stop(agora + inicio + 0.2);
  }
  navigator.vibrate?.([120, 80, 120]);
}

// Notificação no celular (Web Push).

export function pushSuportado(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function chaveParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const preenchido = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binario = atob(preenchido);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export async function chavePublicaPush(): Promise<string | null> {
  const { chave_publica } = await api<{ chave_publica: string | null }>("/api/push/chave-publica");
  return chave_publica;
}

export async function inscricaoAtual(): Promise<PushSubscription | null> {
  const registro = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await registro?.pushManager.getSubscription()) ?? null;
}

export async function ativarPush(chavePublica: string): Promise<void> {
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") {
    throw new Error("Notificações bloqueadas. Libere nas configurações do navegador.");
  }
  const registro = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const inscricao = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: chaveParaBytes(chavePublica),
  });
  await api("/api/push/inscricoes", { metodo: "POST", corpo: inscricao.toJSON() });
}

export async function desativarPush(): Promise<void> {
  const inscricao = await inscricaoAtual();
  if (!inscricao) return;
  await api("/api/push/inscricoes", { metodo: "DELETE", corpo: inscricao.toJSON() });
  await inscricao.unsubscribe();
}
