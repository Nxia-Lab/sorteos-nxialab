export function buildPool(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    dni: entry.dni,
    nombre: entry.nombre,
    telefono: entry.telefono,
    sucursal: entry.sucursal,
    timestamp: entry.timestamp ?? null,
  }));
}

function pickFromPool(pool, amount, blockedDnis) {
  const selected = [];
  const workingPool = pool.filter((entry) => !blockedDnis.has(entry.dni));

  while (workingPool.length > 0 && selected.length < amount) {
    const randomIndex = Math.floor(Math.random() * workingPool.length);
    const winner = workingPool[randomIndex];
    selected.push(winner);
    blockedDnis.add(winner.dni);

    for (let index = workingPool.length - 1; index >= 0; index -= 1) {
      if (workingPool[index].dni === winner.dni) {
        workingPool.splice(index, 1);
      }
    }
  }

  return selected;
}

function pickRoundRobinByBranch(entries, branches, amountPerBranch, blockedDnis) {
  const selected = [];
  const branchPools = new Map(
    branches.map((branch) => [
      branch,
      buildPool(entries).filter((entry) => entry.sucursal === branch && !blockedDnis.has(entry.dni)),
    ]),
  );

  for (let round = 0; round < amountPerBranch; round += 1) {
    branches.forEach((branch) => {
      const pool = branchPools.get(branch) ?? [];
      const eligiblePool = pool.filter((entry) => !blockedDnis.has(entry.dni));

      if (eligiblePool.length === 0) {
        branchPools.set(branch, eligiblePool);
        return;
      }

      const randomIndex = Math.floor(Math.random() * eligiblePool.length);
      const winner = eligiblePool[randomIndex];
      selected.push(winner);
      blockedDnis.add(winner.dni);

      branchPools.set(
        branch,
        eligiblePool.filter((entry) => entry.dni !== winner.dni),
      );
    });
  }

  return selected;
}

export function runRaffle(entries, winnersCount, alternatesCount, options = {}) {
  const { mode = 'global', branches = [] } = options;
  const pool = buildPool(entries);
  const blockedDnis = new Set();

  if (mode === 'branch') {
    const winners = pickRoundRobinByBranch(pool, branches, winnersCount, blockedDnis);
    const alternates = pickRoundRobinByBranch(pool, branches, alternatesCount, blockedDnis);

    return {
      winners,
      alternates,
    };
  }

  const totalNeeded = winnersCount + alternatesCount;
  const selected = pickFromPool(pool, totalNeeded, blockedDnis);

  return {
    winners: selected.slice(0, winnersCount),
    alternates: selected.slice(winnersCount, totalNeeded),
  };
}
