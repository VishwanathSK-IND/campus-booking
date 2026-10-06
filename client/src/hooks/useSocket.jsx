import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useToast } from './useToast.jsx';
import { useAuth } from './useAuth.jsx';

const SocketContext = createContext({ socket: null, connected: false });

/**
 * Socket events are treated as invalidation hints: they tell TanStack Query
 * which server state to refetch. The REST API remains the source of truth, so
 * missed events are harmless — on every reconnect all queries are refetched.
 */
export function SocketProvider({ children }) {
  const { user } = useAuth();
  const userId = user?._id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const hasConnected = useRef(false);

  useEffect(() => {
    if (!userId) return undefined;
    const s = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    hasConnected.current = false;

    s.on('connect', () => {
      setConnected(true);
      // Re-sync after a reconnect: we may have missed events while offline.
      if (hasConnected.current) queryClient.invalidateQueries();
      hasConnected.current = true;
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    const invalidateBookings = () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['booking'] });
    };

    s.on('availability.updated', ({ resourceId, date }) => {
      queryClient.invalidateQueries({ queryKey: ['availability', resourceId, date] });
      queryClient.invalidateQueries({ queryKey: ['availability', resourceId] });
    });
    s.on('resource.statusChanged', ({ resourceId }) => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['resource', resourceId] });
      queryClient.invalidateQueries({ queryKey: ['availability', resourceId] });
    });
    s.on('resource.updated', ({ resourceId }) => queryClient.invalidateQueries({ queryKey: ['resource', resourceId] }));
    for (const event of ['booking.created', 'booking.approved', 'booking.rejected', 'booking.cancelled', 'booking.checkedIn', 'booking.completed', 'booking.noShow', 'booking.expired']) {
      s.on(event, invalidateBookings);
    }
    s.on('booking.updated', () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    });
    s.on('approval.requested', () => queryClient.invalidateQueries({ queryKey: ['approvals'] }));
    s.on('waitlist.promoted', () => queryClient.invalidateQueries({ queryKey: ['waitlist'] }));
    s.on('notification.created', (notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.info(notification.title);
      if (['NO_SHOW', 'RESTRICTION'].includes(notification.type)) queryClient.invalidateQueries({ queryKey: ['standing'] });
    });

    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [userId, queryClient, toast]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}

/** Subscribes to live availability updates for one resource while mounted. */
export function useWatchResource(resourceId) {
  const { socket, connected } = useSocket();
  useEffect(() => {
    if (!socket || !connected || !resourceId) return undefined;
    socket.emit('resource:watch', resourceId);
    return () => socket.emit('resource:unwatch', resourceId);
  }, [socket, connected, resourceId]);
}
