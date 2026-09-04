import { ThemeBuilder } from '@/features/theme-builder';
import { GoogleSignIn } from '@/features/google-sign-in';
import { WorkspaceAdmin } from '@/features/workspace-admin';
import { AccessAdmin } from '@/features/access-admin';
import { DataTransfer } from '@/features/data-transfer';
import { UserSettingsPanel } from '@/features/user-settings';
export function SettingsPage(): React.JSX.Element {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">По вашему вкусу</p>
        <h1>Настройки тетради</h1>
        <p className="muted">
          Управляйте аккаунтом, участниками, переносом данных и внешним видом тетради.
        </p>
      </div>
      <div className="settings-grid">
        <GoogleSignIn />
        <UserSettingsPanel />
        <ThemeBuilder />
        <WorkspaceAdmin mode="directory" />
        <AccessAdmin />
        <DataTransfer />
      </div>
    </>
  );
}
