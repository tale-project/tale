import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useListOneDriveFiles() {
  return useConvexAction(api.onedrive.actions.listFiles);
}

export function useListSharePointSites() {
  return useConvexAction(api.onedrive.actions.listSharePointSites);
}

export function useListSharePointDrives() {
  return useConvexAction(api.onedrive.actions.listSharePointDrives);
}

export function useListSharePointFiles() {
  return useConvexAction(api.onedrive.actions.listSharePointFiles);
}
