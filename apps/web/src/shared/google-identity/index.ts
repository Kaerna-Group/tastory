type IdentityApi = {
  initialize: (options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    auto_select: false;
    ux_mode: 'popup';
    itp_support: true;
    use_fedcm_for_button: true;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'signin_with';
      locale: 'ru';
      width: number;
    },
  ) => void;
  disableAutoSelect: () => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: IdentityApi } };
  }
}
let loading: Promise<IdentityApi> | undefined;
let initialized = false;
let credentialListener: ((credential: string) => void) | undefined;

export function listenGoogleCredential(
  api: IdentityApi,
  clientId: string,
  listener: (credential: string) => void,
) {
  credentialListener = listener;
  if (!initialized) {
    api.initialize({
      client_id: clientId,
      auto_select: false,
      ux_mode: 'popup',
      itp_support: true,
      use_fedcm_for_button: true,
      callback: ({ credential }) => credentialListener?.(credential),
    });
    initialized = true;
  }
  return () => {
    if (credentialListener === listener) credentialListener = undefined;
  };
}

export function loadGoogleIdentity(): Promise<IdentityApi> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timer = setTimeout(fail, 15_000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(
        new Error('Не удалось загрузить кнопку Google. Проверьте соединение и попробуйте снова.'),
      );
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      const api = window.google?.accounts.id;
      if (api) resolve(api);
      else fail();
    };
    document.head.append(script);
  });
  return loading;
}
export function disableGoogleAutoSelect() {
  window.google?.accounts.id.disableAutoSelect();
}
