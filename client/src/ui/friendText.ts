import type { FriendRequestResult } from '../account';
import { t } from '../i18n';

/** Texto para el resultado de una solicitud de amistad. */
export function requestResultText(r: FriendRequestResult): { text: string; ok: boolean } {
  const ok = r === 'sent' || r === 'accepted' || r === 'already';
  return { text: t(`friends.res.${r}`), ok };
}
