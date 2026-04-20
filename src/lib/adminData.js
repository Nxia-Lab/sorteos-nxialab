import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { sortByTimestamp } from './firestoreShared';

const participantsCollection = collection(db, 'participantes');
const rafflesCollection = collection(db, 'sorteos');
const customersCollection = collection(db, 'clientes');
const jornadaOverridesCollection = collection(db, 'jornadaOverrides');

export async function fetchParticipants(raffleId) {
  const baseQuery = raffleId ? query(participantsCollection, where('raffleId', '==', raffleId)) : query(participantsCollection);
  const snapshot = await getDocs(baseQuery);
  return sortByTimestamp(
    snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })),
    'timestamp',
  );
}

export function subscribeParticipants(callback, raffleId) {
  const baseQuery = raffleId ? query(participantsCollection, where('raffleId', '==', raffleId)) : query(participantsCollection);
  return onSnapshot(baseQuery, (snapshot) => {
    callback(
      sortByTimestamp(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        })),
        'timestamp',
      ),
    );
  });
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

export function subscribeCustomers(callback) {
  return onSnapshot(query(customersCollection), (snapshot) => {
    callback(
      sortByTimestamp(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        })),
        'updatedAt',
      ),
    );
  });
}

export async function updateParticipantRecord({ participantId, dni, nombre, telefono, sucursal }) {
  await updateDoc(doc(db, 'participantes', participantId), {
    nombre,
    telefono,
    sucursal,
  });

  if (dni) {
    await updateDoc(doc(db, 'clientes', dni), {
      nombre,
      telefono,
      updatedAt: serverTimestamp(),
    });
  }
}

export async function grantJornadaOverride({ raffleId, dni, jornadaKey, jornadaLabel }) {
  const overrideId = `${raffleId}__${dni}__${jornadaKey}`;

  await setDoc(
    doc(jornadaOverridesCollection, overrideId),
    {
      raffleId,
      dni,
      jornadaKey,
      jornadaLabel,
      remainingUses: increment(1),
      grantedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateRaffleStatus(raffleId, status, extra = {}) {
  await updateDoc(doc(db, 'sorteos', raffleId), {
    status,
    updatedAt: serverTimestamp(),
    ...extra,
  });
}

export async function saveRaffle({ raffleId, name, startAt, endAt, enabledBranches }) {
  if (!raffleId) {
    const newDoc = await addDoc(rafflesCollection, {
      name,
      startAt,
      endAt,
      enabledBranches,
      status: 'active',
      participantsCount: 0,
      winnersCount: 0,
      alternatesCount: 0,
      winners: [],
      alternates: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return newDoc.id;
  }

  await updateDoc(doc(db, 'sorteos', raffleId), {
    name,
    startAt,
    endAt,
    enabledBranches,
    updatedAt: serverTimestamp(),
  });

  return raffleId;
}

export async function completeRaffle({
  raffleId,
  name,
  startAt,
  endAt,
  enabledBranches,
  drawMode,
  participantsCount,
  winnersCount,
  alternatesCount,
  winnersPerGroup,
  alternatesPerGroup,
  winners,
  alternates,
}) {
  await updateDoc(doc(db, 'sorteos', raffleId), {
    name,
    startAt,
    endAt,
    enabledBranches,
    drawMode,
    participantsCount,
    winnersCount,
    alternatesCount,
    winnersPerGroup,
    alternatesPerGroup,
    winners,
    alternates,
    status: 'completed',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
