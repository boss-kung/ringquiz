import { getSupabaseClient } from './supabase';
import type { HostActionCaller, HostActionName } from '../domain/types';

const HOST_PIN_KEY = 'treasure-quiz-host-pin';

export function getStoredHostPin(): string {
  return typeof window === 'undefined' ? '' : window.sessionStorage.getItem(HOST_PIN_KEY) ?? '';
}

export function setStoredHostPin(pin: string): void {
  window.sessionStorage.setItem(HOST_PIN_KEY, pin);
}

export function clearStoredHostPin(): void {
  window.sessionStorage.removeItem(HOST_PIN_KEY);
}

export const hostAction: HostActionCaller = async <T = unknown>(action: HostActionName, payload?: unknown): Promise<T> => {
  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke('treasure-host-action', {
    body: { action, pin: getStoredHostPin(), payload },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error.message ?? data.error.code ?? 'Host action failed');
  return data as T;
};

export const playerAction = async <T = unknown>(action: string, payload?: unknown, pin?: string): Promise<T> => {
  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke('treasure-player-action', {
    body: { action, pin, payload },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error.message ?? data.error.code ?? 'Player action failed');
  return data as T;
};
