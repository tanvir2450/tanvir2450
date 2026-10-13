using Mirror;
using UnityEngine;

namespace Crossroads
{
    /// <summary>Server-authoritative raycast shooting. Click / tap FIRE to shoot.</summary>
    [RequireComponent(typeof(NetworkIdentity))]
    public class WeaponShooter : NetworkBehaviour
    {
        public float fireRate = 0.15f;
        public float range = 100f;
        public int damage = 20;
        public LayerMask hitMask = ~0;

        Camera playerCamera;
        float nextFireTime;

        public override void OnStartLocalPlayer()
        {
            base.OnStartLocalPlayer();
            playerCamera = GetComponentInChildren<Camera>(true);
        }

        void Update()
        {
            if (!isLocalPlayer) return;
            if (Input.GetMouseButton(0) && Time.time >= nextFireTime && !TouchOverUI())
                TryFire();
        }

        bool TouchOverUI()
        {
            // Don't shoot when the player is dragging the joystick / pressing FIRE button UI.
            return UnityEngine.EventSystems.EventSystem.current != null
                && Input.touchCount > 0
                && UnityEngine.EventSystems.EventSystem.current.IsPointerOverGameObject(Input.GetTouch(0).fingerId);
        }

        /// <summary>Called by the mobile FIRE button.</summary>
        public void FireButton() => TryFire();

        void TryFire()
        {
            if (Time.time < nextFireTime) return;
            nextFireTime = Time.time + fireRate;
            if (playerCamera == null) playerCamera = GetComponentInChildren<Camera>(true);
            if (playerCamera == null) return;
            CmdShoot(playerCamera.transform.position, playerCamera.transform.forward);
        }

        [Command]
        void CmdShoot(Vector3 origin, Vector3 direction)
        {
            if (Physics.Raycast(origin, direction, out RaycastHit hit, range, hitMask))
            {
                var target = hit.collider.GetComponentInParent<PlayerHealth>();
                if (target != null && target.netId != netId)
                    target.TakeDamage(damage);
                RpcHitEffect(hit.point);
            }
        }

        [ClientRpc]
        void RpcHitEffect(Vector3 point)
        {
            Debug.DrawLine(point + Vector3.up * 0.2f, point - Vector3.up * 0.2f, Color.magenta, 0.15f);
        }
    }
}
