export async function runStudentAdminAuthBootstrap({
  api,
  state,
  showLogin,
  showApp,
  setStatus,
  handleError,
  bootAfterLogin,
  isStaticAdminPreviewMode,
  ADMIN_API_ORIGIN,
  staticPreviewHelpMessage,
  currentRoleName,
  normalizeRolePolicy,
  getCurrentRolePolicy,
} = {}) {
  if (isStaticAdminPreviewMode?.() && !ADMIN_API_ORIGIN) {
    showLogin?.();
    setStatus?.(staticPreviewHelpMessage?.() || "", true);
    return { status: "preview" };
  }

  let me;
  try {
    me = await api?.("/api/admin/auth/me?bootstrap=1");
  } catch (error) {
    showLogin?.();
    if (error && error.status && error.status !== 401) {
      setStatus?.(error.message || "Unable to restore session.", true);
    }
    return { status: "unauthenticated", error };
  }

  if (me?.authenticated === false) {
    if (globalThis?.window?.__SIS_DEBUG_AUTH__) {
      globalThis.console?.debug?.(`[SIS auth] bootstrap: ${me.reason || "unauthenticated"}`);
    }
    showLogin?.();
    return { status: "unauthenticated", reason: me.reason || "unauthenticated" };
  }

  state.authUser = me?.user || null;
  state.authRolePolicy = normalizeRolePolicy?.(
    currentRoleName?.(),
    me?.rolePolicy,
    getCurrentRolePolicy?.(),
  );
  showApp?.();
  setStatus?.(`Authenticated as ${state.authUser?.username || "admin"}.`);

  try {
    await bootAfterLogin?.();
  } catch (error) {
    handleError?.(error);
  }

  return { status: "authenticated", user: state.authUser || null };
}
