import { Link } from 'react-router-dom';
import { FiCompass } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';

export default function NotFound() {
  return (
    <PageMotion className="flex min-h-[calc(100vh-92px)] flex-col items-center justify-center gap-3 px-4 text-center">
      <FiCompass className="text-4xl text-faint" />
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="text-sm text-subtle">That workspace doesn&apos;t exist.</p>
      <Link to="/" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover hover:no-underline">
        Back to workspaces
      </Link>
    </PageMotion>
  );
}
