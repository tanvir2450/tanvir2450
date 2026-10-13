#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Crossroads;
using Mirror;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Crossroads.Editor
{
    /// <summary>
    /// One-click MVP builder: creates the Neon Stickman prefab, Future Desert scene,
    /// NetworkManager (KCP transport) and mobile HUD, and wires every reference.
    /// Runs automatically on first import; re-run anytime from
    /// menu: Crossroads > Build MVP Scene.
    /// </summary>
    [InitializeOnLoad]
    public static class CrossroadsSetup
    {
        const string PrefabPath = "Assets/Prefabs/Player_Stickman.prefab";
        const string ScenePath = "Assets/Scenes/FutureDesert.unity";
        const string MaterialPath = "Assets/Materials/NeonSand.mat";

        static CrossroadsSetup()
        {
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(PrefabPath) || !File.Exists(ScenePath))
                    Build();
            };
        }

        [MenuItem("Crossroads/Build MVP Scene")]
        public static void Build()
        {
            EnsureFolders();
            Material neonSand = CreateNeonSand();
            GameObject prefab = CreatePlayerPrefab(neonSand);
            BuildScene(prefab, neonSand);
            Debug.Log("[Crossroads] MVP ready: open Assets/Scenes/FutureDesert, press Play, click HOST.");
        }

        static void EnsureFolders()
        {
            foreach (string f in new[] { "Assets/Prefabs", "Assets/Scenes", "Assets/Materials" })
                if (!AssetDatabase.IsValidFolder(f))
                    AssetDatabase.CreateFolder(Path.GetDirectoryName(f), Path.GetFileName(f));
        }

        static Material CreateNeonSand()
        {
            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (mat != null) return mat;
            mat = new Material(Shader.Find("Standard"));
            mat.color = new Color(0.12f, 0.05f, 0.25f);                    // dark purple-blue
            mat.SetColor("_EmissionColor", new Color(1f, 0.15f, 0.6f) * 0.35f); // faint neon pink
            mat.EnableKeyword("_EMISSION");
            AssetDatabase.CreateAsset(mat, MaterialPath);
            return mat;
        }

        static GameObject CreatePlayerPrefab(Material neonSand)
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (existing != null) return existing;

            var root = new GameObject("Player_Stickman");
            root.transform.localScale = new Vector3(0.5f, 1f, 0.5f);

            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.name = "Body";
            body.transform.SetParent(root.transform, false);
            UnityEngine.Object.DestroyImmediate(body.GetComponent<Collider>()); // CharacterController only!
            body.GetComponent<MeshRenderer>().sharedMaterial = neonSand;

            var camGo = new GameObject("PlayerCamera");
            camGo.transform.SetParent(root.transform, false);
            camGo.transform.localPosition = new Vector3(0f, 0.6f, 0f);
            var cam = camGo.AddComponent<Camera>();
            cam.enabled = false; // enabled per-player in OnStartLocalPlayer()

            var cc = root.AddComponent<CharacterController>();
            cc.radius = 0.25f; cc.height = 1f; cc.center = Vector3.zero;

            root.AddComponent<NetworkIdentity>();
            AddNetworkTransform(root);
            var controller = root.AddComponent<MobileTouchController>();
            controller.playerCamera = cam;
            root.AddComponent<WeaponShooter>();
            root.AddComponent<PlayerHealth>();

            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
            UnityEngine.Object.DestroyImmediate(root);
            return prefab;
        }

        static void BuildScene(GameObject playerPrefab, Material neonSand)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // Ground
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "NeonSand_Ground";
            ground.transform.localScale = new Vector3(10f, 1f, 10f);
            ground.GetComponent<MeshRenderer>().sharedMaterial = neonSand;

            // Neon cover blocks
            for (int i = 0; i < 6; i++)
            {
                var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.name = $"NeonCover_{i}";
                float angle = i * 60f * Mathf.Deg2Rad;
                block.transform.position = new Vector3(Mathf.Cos(angle) * 6f, 1f, Mathf.Sin(angle) * 6f);
                block.transform.localScale = new Vector3(2f, 2f, 0.5f);
                block.transform.rotation = Quaternion.Euler(0f, -angle * Mathf.Rad2Deg, 0f);
                block.GetComponent<MeshRenderer>().sharedMaterial = neonSand;
            }

            // Light (cyan, no shadows = mobile-friendly)
            var lightGo = new GameObject("Directional Light");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = Color.cyan;
            light.shadows = LightShadowType.None;
            lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // Network
            var nmGo = new GameObject("NetworkManager");
            var manager = nmGo.AddComponent<CustomNetworkManager>();
            AddTransport(nmGo);
            manager.playerPrefab = playerPrefab;
            manager.networkAddress = "localhost";

            BuildHUD();

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
        }

        static void AddTransport(GameObject go)
        {
            // Find Mirror's KCP transport by reflection (namespace differs across Mirror versions).
            Type kcp = AppDomain.CurrentDomain.GetAssemblies()
                .SelectMany(a => { try { return a.GetTypes(); } catch { return new Type[0]; } })
                .FirstOrDefault(t => t.Name == "KcpTransport" && typeof(Component).IsAssignableFrom(t));
            if (kcp != null) go.AddComponent(kcp);
            else Debug.LogWarning("[Crossroads] KcpTransport not found; add a Mirror Transport component manually.");
        }

        static void BuildHUD()
        {
            var canvasGo = new GameObject("MobileHUD");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvasGo.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGo.AddComponent<GraphicRaycaster>();

            var eventSystem = new GameObject("EventSystem");
            eventSystem.AddComponent<EventSystem>();
            eventSystem.AddComponent<StandaloneInputModule>();

            // Joystick (bottom-left)
            var joyGo = new GameObject("Joystick");
            joyGo.transform.SetParent(canvasGo.transform, false);
            var joyRect = joyGo.AddComponent<RectTransform>();
            joyRect.anchorMin = joyRect.anchorMax = new Vector2(0f, 0f);
            joyRect.anchoredPosition = new Vector2(140f, 140f);
            joyRect.sizeDelta = new Vector2(180f, 180f);
            joyGo.AddComponent<Image>().color = new Color(1f, 1f, 1f, 0.15f);
            var joystick = joyGo.AddComponent<TouchJoystick>();

            var knobGo = new GameObject("Knob");
            knobGo.transform.SetParent(joyGo.transform, false);
            var knobRect = knobGo.AddComponent<RectTransform>();
            knobRect.sizeDelta = new Vector2(70f, 70f);
            knobGo.AddComponent<Image>().color = new Color(1f, 0.3f, 0.8f, 0.6f);
            joystick.knob = knobRect;

            // FIRE button (bottom-right)
            var fireGo = new GameObject("FireButton");
            fireGo.transform.SetParent(canvasGo.transform, false);
            var fireRect = fireGo.AddComponent<RectTransform>();
            fireRect.anchorMin = fireRect.anchorMax = new Vector2(1f, 0f);
            fireRect.anchoredPosition = new Vector2(-120f, 140f);
            fireRect.sizeDelta = new Vector2(110f, 110f);
            fireGo.AddComponent<Image>().color = new Color(1f, 0.2f, 0.3f, 0.6f);
            var button = fireGo.AddComponent<Button>();
            button.onClick.AddListener(joystick.OnFireButton);

            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(fireGo.transform, false);
            var labelRect = labelGo.AddComponent<RectTransform>();
            labelRect.anchorMin = Vector2.zero; labelRect.anchorMax = Vector2.one;
            var label = labelGo.AddComponent<Text>();
            label.text = "FIRE"; label.alignment = TextAnchor.MiddleCenter;
            label.color = Color.white; label.fontSize = 22;
            label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }
    }
}
#endif
