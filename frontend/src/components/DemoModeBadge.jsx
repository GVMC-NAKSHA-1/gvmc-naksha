import { useSelector } from 'react-redux';
import { selectDataMode } from '../Redux/slices/adminSlice';
import { Badge } from './ui';

export default function DemoModeBadge() {
  const dataMode = useSelector(selectDataMode);
  if (dataMode === 'live') return null;
  return <Badge tone="warning" role="status">Demo Mode</Badge>;
}
