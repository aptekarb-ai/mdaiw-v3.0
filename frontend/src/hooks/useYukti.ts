import { useContext } from 'react';
import { YuktiContext } from '../context/YuktiContext';

export function useYukti() {
  const context = useContext(YuktiContext);
  if (!context) {
    throw new Error('useYukti must be used within a YuktiProvider');
  }
  return context;
}
