using Mirror;
using UnityEngine;

namespace Crossroads
{
    public class PlayerHealth : NetworkBehaviour
    {
        [SyncVar(hook = nameof(OnHealthChanged))]
        public int health = 100;

        public int maxHealth = 100;

        [Server]
        public void TakeDamage(int amount)
        {
            if (health <= 0) return;
            health = Mathf.Max(0, health - amount);
            if (health == 0) RpcRespawn();
        }

        void OnHealthChanged(int oldValue, int newValue)
        {
            if (isLocalPlayer) Debug.Log($"[Crossroads] Health: {newValue}/{maxHealth}");
        }

        [ClientRpc]
        void RpcRespawn()
        {
            var cc = GetComponent<CharacterController>();
            if (cc != null) cc.enabled = false;
            transform.position = new Vector3(Random.Range(-4f, 4f), 1f, Random.Range(-4f, 4f));
            if (cc != null) cc.enabled = true;
        }
    }
}
