// Intentionally minimal. The heavy 5-step welcome modal was replaced by an
// inline coach-mark pill rendered directly inside the editor (see
// src/pages/RouteEditor.tsx). This component remains as a no-op export so
// existing imports keep working; it can be deleted once all call sites are
// removed.
interface EditorWelcomeModalProps {
  onStartTour: () => void;
  userId: string;
}

const EditorWelcomeModal = (_props: EditorWelcomeModalProps) => null;

export default EditorWelcomeModal;
