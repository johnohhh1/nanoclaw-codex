export function shouldResetRejectedModelSession(
  sessionId: string | undefined,
  error: string | undefined,
): boolean {
  if (!sessionId || !error) return false;

  const normalized = error.toLowerCase();
  return (
    normalized.includes('model is not supported') &&
    normalized.includes('chatgpt account')
  );
}
