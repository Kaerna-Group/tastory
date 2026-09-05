import { env } from '@/shared/config';
import { useConnectionStatus } from '../api/health-query';
export function ConnectionStatus(): React.JSX.Element {
  const health = useConnectionStatus();
  return (
    <section className="panel" aria-labelledby="connection-title">
      <h2 id="connection-title">Подключение</h2>
      <p className="muted">
        {env.apiMode === 'mock'
          ? 'Локальный режим: ответы имитируются, данные не отправляются в Google.'
          : 'Проверка связи с сервером Tastory.'}
      </p>
      <p role="status" className="connection-status">
        {health.isFetching
          ? 'Проверяем соединение…'
          : health.isError
            ? 'Связь недоступна. Повторите проверку.'
            : health.data?.isReachable
              ? 'Соединение проверено'
              : 'Проверка ещё не выполнена'}
      </p>
      <p className="muted text-sm">
        {health.data?.isReachable
          ? env.apiMode === 'mock'
            ? 'Данные этого экрана тестовые; готовность личной библиотеки проверяется после входа.'
            : `Сервер отвечает, версия ${health.data.deploymentVersion}. Готовность личной библиотеки и права проверяются после входа, а не этой публичной проверкой.`
          : 'Готовность библиотеки и права будут проверены только после успешного соединения и входа.'}
      </p>
      <button
        type="button"
        className="button button-secondary mt-5"
        disabled={health.isFetching}
        onClick={() => {
          void health.refetch();
        }}
      >
        Проверить снова
      </button>
    </section>
  );
}
