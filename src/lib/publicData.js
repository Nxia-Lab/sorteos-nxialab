import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  onSnapshot,
  setDoc,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { sortByTimestamp } from './firestoreShared';

const participantsCollection = collection(db, 'participantes');
const rafflesCollection = collection(db, 'sorteos');
const customersCollection = collection(db, 'clientes');
const jornadaOverridesCollection = collection(db, 'jornadaOverrides');
const appConfigRef = doc(db, 'appConfig', 'publicAccess');

function getJornadaOverrideId({ raffleId, dni, jornadaKey }) {
  return `${raffleId}__${dni}__${jornadaKey}`;
}

async function canRegisterAgain({ dni, raffleId, jornadaKey }) {
  const duplicateSnapshot = await getDocs(query(participantsCollection, where('dni', '==', dni)));
  const duplicateInJornada = duplicateSnapshot.docs.some((item) => {
    const data = item.data();
    return data.raffleId === raffleId && data.jornadaKey === jornadaKey;
  });

  if (!duplicateInJornada) {
    return {
      allowed: true,
      overrideRef: null,
    };
  }

  const overrideRef = doc(jornadaOverridesCollection, getJornadaOverrideId({ raffleId, dni, jornadaKey }));
  const overrideSnapshot = await getDoc(overrideRef);

  if (!overrideSnapshot.exists()) {
    return {
      allowed: false,
      overrideRef,
    };
  }

  const remainingUses = Number(overrideSnapshot.data()?.remainingUses ?? 0);
  if (remainingUses <= 0) {
    return {
      allowed: false,
      overrideRef,
    };
  }

  return {
    allowed: true,
    overrideRef,
    remainingUses,
  };
}

async function areRegistrationsEnabled() {
  const snapshot = await getDoc(appConfigRef);

  if (!snapshot.exists()) {
    return true;
  }

  return snapshot.data()?.registrationsEnabled !== false;
}

export async function createParticipant({
  dni,
  nombre,
  telefono,
  sucursal,
  raffleId,
  raffleName,
  jornadaKey,
  jornadaLabel,
  jornadaStartAt,
  jornadaEndAt,
}) {
  const registrationsEnabled = await areRegistrationsEnabled();

  if (!registrationsEnabled) {
    throw new Error('Las inscripciones están cerradas por el administrador.');
  }

  const access = await canRegisterAgain({ dni, raffleId, jornadaKey });

  if (!access.allowed) {
    throw new Error('Pedile al administrador que lo registre.');
  }

  const participantPromise = addDoc(participantsCollection, {
    dni,
    nombre,
    telefono,
    sucursal,
    raffleId,
    raffleName,
    jornadaKey,
    jornadaLabel,
    jornadaStartAt,
    jornadaEndAt,
    timestamp: serverTimestamp(),
  });

  const customerPromise = setDoc(
    doc(customersCollection, dni),
    {
      dni,
      nombre,
      telefono,
      sucursales: arrayUnion(sucursal),
      lastRaffleId: raffleId,
      lastRaffleName: raffleName,
      lastJornadaKey: jornadaKey,
      lastJornadaLabel: jornadaLabel,
      lastParticipationAt: serverTimestamp(),
      totalParticipations: increment(1),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  const [participantRef] = await Promise.all([participantPromise, customerPromise]);

  if (access.overrideRef) {
    const nextRemainingUses = Math.max((access.remainingUses ?? 1) - 1, 0);
    await updateDoc(access.overrideRef, {
      remainingUses: nextRemainingUses,
      updatedAt: serverTimestamp(),
    });
  }

  return participantRef;
}

export function subscribeRaffles(callback) {
  return onSnapshot(query(rafflesCollection), (snapshot) => {
    callback(
      sortByTimestamp(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        })),
        'createdAt',
      ),
    );
  });
}
