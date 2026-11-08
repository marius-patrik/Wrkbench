import { GithubAuthController } from "./github/auth-controller";
import { FactoryProvider } from "./factory/context";
import { RepositoryDialog } from "./workspace/repository-dialog";
import { WorkspaceProvider, useWorkspace } from "./workspace/context";
import { WorkbenchShell } from "./workbench/shell";

function IdentityBoundWorkbench() {
  const { principal, ownershipGeneration, workspace } = useWorkspace();
  // Repository/ref sessions own independent Dockview tab trees. Remount the
  // full surface when the immutable workspace identity changes: private A
  // tabs and titles must not remain visible after opening unrelated B.
  return (
    <FactoryProvider key={`${principal.key}:${ownershipGeneration}:${workspace?.id ?? "no-workspace"}`}>
      <WorkbenchShell />
    </FactoryProvider>
  );
}

function IdentityBoundRepositoryDialog() {
  const { principal, ownershipGeneration } = useWorkspace();
  return <RepositoryDialog key={`${principal.key}:${ownershipGeneration}`} />;
}

export function WorkbenchApp() {
  return (
    <WorkspaceProvider>
      <GithubAuthController />
      <IdentityBoundWorkbench />
      <IdentityBoundRepositoryDialog />
    </WorkspaceProvider>
  );
}
