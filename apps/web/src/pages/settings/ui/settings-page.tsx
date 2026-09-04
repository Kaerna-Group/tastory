import { ThemeBuilder } from '@/features/theme-builder';
import { ConnectionStatus } from '@/features/connection-status';
import { GoogleSignIn } from '@/features/google-sign-in';
import { PhotoProbe } from '@/features/photo-probe';
import { ConcurrencyProbe } from '@/features/concurrency-probe';
import { WorkspaceAdmin } from '@/features/workspace-admin';
import { OperationJournal } from '@/features/operation-journal';
import { AccessAdmin } from '@/features/access-admin';
import { BookBackups } from '@/features/book-backups';
import { FileManagement } from '@/features/file-management';
import { DataTransfer } from '@/features/data-transfer';
import { UserSettingsPanel } from '@/features/user-settings';
export function SettingsPage(): React.JSX.Element {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">По вашему вкусу</p>
        <h1>Настройки тетради</h1>
        <p className="muted">Выберите удобный внешний вид и проверьте подключение.</p>
      </div>
      <div className="settings-grid">
        <GoogleSignIn />
        <UserSettingsPanel />
        <PhotoProbe />
        <ThemeBuilder />
        <ConnectionStatus />
        <WorkspaceAdmin />
        <AccessAdmin />
        <OperationJournal />
        <BookBackups />
        <FileManagement />
        <DataTransfer />
        <ConcurrencyProbe />
      </div>
    </>
  );
}
