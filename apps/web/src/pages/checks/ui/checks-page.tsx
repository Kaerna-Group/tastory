import { BookBackups } from '@/features/book-backups';
import { ConcurrencyProbe } from '@/features/concurrency-probe';
import { ConnectionStatus } from '@/features/connection-status';
import { FileManagement } from '@/features/file-management';
import { GoogleSignIn } from '@/features/google-sign-in';
import { OperationJournal } from '@/features/operation-journal';
import { PhotoProbe } from '@/features/photo-probe';
import { WorkspaceAdmin } from '@/features/workspace-admin';

export function ChecksPage(): React.JSX.Element {
  return (
    <>
      <div className="page-heading checks-heading">
        <p className="eyebrow">Состояние и обслуживание</p>
        <h1>Проверки тетради</h1>
        <p className="muted">
          Здесь собраны служебные проверки, журнал, резервные копии и обслуживание файлов.
        </p>
      </div>
      <ol className="checks-flow" aria-label="Порядок проверки">
        <li>
          <span aria-hidden="true">01</span>
          <div>
            <strong>Вход и связь</strong>
            <p>Подтвердите аккаунт и соединение с сервером.</p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">02</span>
          <div>
            <strong>Данные и файлы</strong>
            <p>Проверьте таблицы, фотографии и целостность файлов.</p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">03</span>
          <div>
            <strong>Восстановление</strong>
            <p>Проверьте журнал и создайте резервную копию.</p>
          </div>
        </li>
      </ol>
      <div className="checks-grid">
        <GoogleSignIn showAccessCheck />
        <ConnectionStatus />
        <WorkspaceAdmin mode="health" />
        <PhotoProbe />
        <OperationJournal />
        <BookBackups />
        <FileManagement />
        <ConcurrencyProbe />
      </div>
    </>
  );
}
