import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const appConfigRef = doc(db, 'appConfig', 'publicAccess');

export function subscribeAppConfig(callback) {
  return onSnapshot(appConfigRef, (snapshot) => {
    const data = snapshot.exists() ? snapshot.data() : {};
    callback({
      registrationsEnabled: data.registrationsEnabled !== false,
      updatedAt: data.updatedAt ?? null,
    });
  });
}

export async function setRegistrationsEnabled(enabled) {
  await setDoc(
    appConfigRef,
    {
      registrationsEnabled: enabled,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
