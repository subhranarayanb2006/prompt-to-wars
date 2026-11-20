import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';

export interface UserProfileData {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  callsign: string;
  homeHub: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfileData | null;
  authReady: boolean;
  profileReady: boolean;
  showLoginPortal: boolean;
  authLoading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  continueAsGuest: () => void;
  openLoginPortal: () => void;
  updateProfile: (updates: { callsign: string; homeHub: string; displayName?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GUEST_STORAGE_KEY = 'domino-sky-guest-mode';

function sanitizeString(value: string, maxLen: number, fallback: string): string {
  const cleaned = value.trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeIata(value: string): string {
  const up = value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return /^[A-Z]{3}$/.test(up) ? up : 'BOM';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showLoginPortal, setShowLoginPortal] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem(GUEST_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);

      if (!firebaseUser) {
        setProfile(null);
        setProfileReady(false);
        return;
      }

      setShowLoginPortal(false);
      setProfileReady(false);

      const userPath = `users/${firebaseUser.uid}`;
      const userRef = doc(db, 'users', firebaseUser.uid);

      try {
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const d = snap.data();
          setProfile({
            uid: firebaseUser.uid,
            displayName: String(d.displayName ?? firebaseUser.displayName ?? 'OCC Dispatcher'),
            email: String(d.email ?? firebaseUser.email ?? ''),
            photoURL: String(d.photoURL ?? firebaseUser.photoURL ?? ''),
            callsign: String(d.callsign ?? 'OCC-IND-01'),
            homeHub: sanitizeIata(String(d.homeHub ?? 'BOM')),
          });
        } else {
          const initialDisplayName = sanitizeString(
            firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? 'OCC Dispatcher',
            80,
            'OCC Dispatcher'
          );
          const initialEmail = sanitizeString(firebaseUser.email ?? 'operator@dominosky.app', 160, 'operator@dominosky.app');
          const initialPhoto = (firebaseUser.photoURL ?? '').trim().slice(0, 500);
          const initialCallsign = `OCC-${initialDisplayName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'OPS'}-01`;

          await setDoc(userRef, {
            uid: firebaseUser.uid,
            displayName: initialDisplayName,
            email: initialEmail,
            photoURL: initialPhoto,
            callsign: initialCallsign,
            homeHub: 'BOM',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          setProfile({
            uid: firebaseUser.uid,
            displayName: initialDisplayName,
            email: initialEmail,
            photoURL: initialPhoto,
            callsign: initialCallsign,
            homeHub: 'BOM',
          });
        }
        setProfileReady(true);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      try {
        window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
      } catch {
        // ignore storage error
      }
      setShowLoginPortal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in with Google.';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('Sign-in popup was closed before completing authentication.');
      } else if (msg.includes('popup-blocked')) {
        setAuthError('Browser blocked the Google sign-in popup. Please allow popups and try again.');
      } else {
        setAuthError(msg);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const signOutUser = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signOut(auth);
      setProfile(null);
      setProfileReady(false);
      setShowLoginPortal(true);
      try {
        window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
      } catch {
        // ignore storage error
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const continueAsGuest = () => {
    setAuthError(null);
    setShowLoginPortal(false);
    try {
      window.sessionStorage.setItem(GUEST_STORAGE_KEY, '1');
    } catch {
      // ignore storage error
    }
  };

  const openLoginPortal = () => {
    setAuthError(null);
    setShowLoginPortal(true);
  };

  const updateProfile = async (updates: { callsign: string; homeHub: string; displayName?: string }) => {
    if (!user || !profile) return;
    const userPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);
    const nextCallsign = sanitizeString(updates.callsign, 40, profile.callsign);
    const nextHub = sanitizeIata(updates.homeHub);
    const nextName = sanitizeString(updates.displayName ?? profile.displayName, 80, profile.displayName);

    try {
      await updateDoc(userRef, {
        displayName: nextName,
        callsign: nextCallsign,
        homeHub: nextHub,
        updatedAt: serverTimestamp(),
      });
      setProfile((prev) =>
        prev ? { ...prev, displayName: nextName, callsign: nextCallsign, homeHub: nextHub } : prev
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        profileReady,
        showLoginPortal,
        authLoading,
        authError,
        signInWithGoogle,
        signOutUser,
        continueAsGuest,
        openLoginPortal,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
