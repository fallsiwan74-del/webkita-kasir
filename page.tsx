"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import {
  Bell,
  ChevronRight,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Settings,
  Share2,
  ShoppingBag,
  Sun,
  Upload,
  X,
} from "lucide-react";

type Product = {
  id: number;
  name: string;
  category: string;
  cost: number;
  price: number;
  stock: number;
  active: boolean;
};
type Sale = {
  id: number;
  firestoreId?: string;
  product: string;
  price: number;
  cost: number;
  profit: number;
  time: string;
  date: string;
};
type SettingsData = {
  business: string;
  branch: string;
  deletePassword: string;
  referral: string;
  photoUrl: string;
};
type AppNotification = {
  id: string;
  title: string;
  text: string;
  time: string;
  createdAt: string;
  kind?: string;
};

const emptySettings: SettingsData = {
  business: "",
  branch: "",
  deletePassword: "",
  referral: "",
  photoUrl: "",
};

const money = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

const hashPassword = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const localKey = (name: string, uid: string) => `webkita-${name}-${uid}`;

const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);

const formatNow = () =>
  new Date().toLocaleString("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
  });

/** Kompres gambar agar photoUrl tidak melebihi batas Firestore (~1MB). */
const compressImage = (file: File, maxSize = 400, quality = 0.72): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal memuat gambar"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export default function Page() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
    name: "",
  });
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState("Kasir");
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<SettingsData>(emptySettings);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [filterDate, setFilterDate] = useState("");
  const [form, setForm] = useState({
    name: "",
    category: "Minuman",
    cost: "",
    price: "",
    stock: "",
  });
  const [profileDraft, setProfileDraft] = useState(emptySettings);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      return;
    }
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("webkita-theme") as
      | "light"
      | "dark"
      | null;
    if (storedTheme) setTheme(storedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("webkita-theme", theme);
  }, [theme]);

  const persistLocal = (
    uid: string,
    nextProducts?: Product[],
    nextSales?: Sale[],
    nextSettings?: SettingsData,
    nextNotifications?: AppNotification[],
  ) => {
    try {
      if (nextProducts)
        window.localStorage.setItem(
          localKey("products", uid),
          JSON.stringify(nextProducts),
        );
      if (nextSales)
        window.localStorage.setItem(
          localKey("sales", uid),
          JSON.stringify(nextSales),
        );
      if (nextSettings)
        window.localStorage.setItem(
          localKey("settings", uid),
          JSON.stringify(nextSettings),
        );
      if (nextNotifications)
        window.localStorage.setItem(
          localKey("notifications", uid),
          JSON.stringify(nextNotifications.slice(0, 100)),
        );
    } catch (error) {
      console.error("[webkita] localStorage write failed", error);
    }
  };

  useEffect(() => {
    if (!user) {
      setDataReady(false);
      return;
    }
    const loadUserData = async () => {
      setDataReady(false);
      const next = { ...emptySettings, business: user.displayName || "" };
      setSettings(next);
      setProfileDraft(next);

      // Tour: tampilkan saat pertama kali buka akun
      if (!window.localStorage.getItem(`webkita-tour-${user.uid}`)) {
        setTourStep(0);
        setShowTour(true);
      }

      // Cadangan lokal dulu agar UI tidak kosong
      try {
        const localProducts = window.localStorage.getItem(
          localKey("products", user.uid),
        );
        const localSales = window.localStorage.getItem(
          localKey("sales", user.uid),
        );
        const localSettings = window.localStorage.getItem(
          localKey("settings", user.uid),
        );
        const localNotif = window.localStorage.getItem(
          localKey("notifications", user.uid),
        );
        if (localProducts) setProducts(JSON.parse(localProducts));
        if (localSales) setSales(JSON.parse(localSales));
        if (localSettings) {
          const parsed = { ...emptySettings, ...JSON.parse(localSettings) };
          setSettings(parsed);
          setProfileDraft(parsed);
        }
        if (localNotif) setNotifications(JSON.parse(localNotif));
      } catch {
        /* ignore corrupt local data */
      }

      if (!db) {
        setToast("Firebase belum dikonfigurasi. Data lokal dipakai.");
        setDataReady(true);
        return;
      }

      try {
        const profileSnap = await getDoc(
          doc(db, "users", user.uid, "profile", "settings"),
        );
        if (profileSnap.exists()) {
          const profile = {
            ...emptySettings,
            ...profileSnap.data(),
          } as SettingsData;
          setSettings(profile);
          setProfileDraft({
            ...profile,
            // Jangan tampilkan hash di input; kosongkan field sandi di form
            deletePassword: "",
          });
          persistLocal(user.uid, undefined, undefined, profile);
        }

        const [productsSnap, salesSnap, notificationSnap] = await Promise.all([
          getDocs(collection(db, "users", user.uid, "products")),
          getDocs(collection(db, "users", user.uid, "sales")),
          getDocs(collection(db, "users", user.uid, "notifications")),
        ]);

        const loadedProducts = productsSnap.docs.map(
          (item) => ({ id: Number(item.id), ...item.data() }) as Product,
        );
        const loadedSales = salesSnap.docs
          .map(
            (item) =>
              ({
                id: Number(item.data().id ?? item.id),
                firestoreId: item.id,
                ...item.data(),
              }) as Sale,
          )
          .sort((a, b) =>
            `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`),
          );
        const loadedNotifs = notificationSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as AppNotification)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        setProducts(loadedProducts);
        setSales(loadedSales);
        setNotifications(loadedNotifs);
        persistLocal(
          user.uid,
          loadedProducts,
          loadedSales,
          undefined,
          loadedNotifs,
        );
      } catch (error) {
        console.error("[webkita] Firebase data load failed", error);
        setToast(
          "Firebase tidak dapat diakses. Data lokal dimuat sebagai cadangan.",
        );
      } finally {
        setDataReady(true);
      }
    };
    void loadUserData();
  }, [user]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  if (user === undefined)
    return (
      <div className="auth-screen">
        <img
          className="auth-logo"
          src="/webkita-logo.png"
          alt="WebKita Kasir"
        />
        <p>Memuat aplikasi...</p>
      </div>
    );

  if (!user)
    return (
      <AuthScreen
        mode={mode}
        setMode={setMode}
        form={authForm}
        setForm={setAuthForm}
        error={authError}
        setError={setAuthError}
      />
    );

  const dateKey = new Date().toISOString().slice(0, 10);
  const monthKey = dateKey.slice(0, 7);
  const todaySales = sales.filter((sale) => sale.date === dateKey);
  const monthSales = sales.filter((sale) => sale.date.startsWith(monthKey));
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.price, 0);
  const todayProfit = todaySales.reduce((sum, sale) => sum + sale.profit, 0);
  const monthRevenue = monthSales.reduce((sum, sale) => sum + sale.price, 0);
  const monthProfit = monthSales.reduce((sum, sale) => sum + sale.profit, 0);
  const filteredSales = filterDate
    ? sales.filter((sale) => sale.date === filterDate)
    : sales;
  const initials = (settings.business || user.displayName || user.email || "WK")
    .slice(0, 2)
    .toUpperCase();

  const writeNotification = async (
    notification: Omit<AppNotification, "id">,
  ) => {
    const local: AppNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...notification,
    };
    setNotifications((items) => {
      const next = [local, ...items].slice(0, 100);
      persistLocal(user.uid, undefined, undefined, undefined, next);
      return next;
    });
    if (db) {
      try {
        const saved = await addDoc(
          collection(db, "users", user.uid, "notifications"),
          notification,
        );
        setNotifications((items) => {
          const next = items.map((item) =>
            item.id === local.id ? { ...notification, id: saved.id } : item,
          );
          persistLocal(user.uid, undefined, undefined, undefined, next);
          return next;
        });
      } catch {
        /* sudah tersimpan lokal */
      }
    }
  };

  const saveProfile = async (opts?: {
    newDeletePassword?: string;
    clearDeletePassword?: boolean;
  }) => {
    const next: SettingsData = {
      ...profileDraft,
      // Jangan simpan plain text dari input sandi di draft
      deletePassword: settings.deletePassword,
    };

    if (opts?.clearDeletePassword) {
      next.deletePassword = "";
    } else if (opts?.newDeletePassword) {
      next.deletePassword = await hashPassword(opts.newDeletePassword);
    }

    // pastikan photoUrl dari draft ikut
    next.photoUrl = profileDraft.photoUrl || "";
    next.business = profileDraft.business.trim();
    next.branch = profileDraft.branch.trim();
    next.referral = profileDraft.referral.trim().toUpperCase();

    setSettings(next);
    setProfileDraft({
      ...next,
      deletePassword: "",
    });
    persistLocal(user.uid, undefined, undefined, next);

    let profileSynced = true;
    if (db) {
      try {
        await setDoc(doc(db, "users", user.uid, "profile", "settings"), next, {
          merge: true,
        });
      } catch (error) {
        profileSynced = false;
        console.error("[webkita] Profile sync failed", error);
      }
    }

    await writeNotification({
      title: "Pengaturan disimpan",
      text: `Profil toko diperbarui${next.business ? `: ${next.business}` : ""}${next.branch ? ` · ${next.branch}` : ""}${opts?.newDeletePassword ? " · Sandi penghapusan diubah" : opts?.clearDeletePassword ? " · Sandi penghapusan dihapus" : ""}.`,
      time: formatNow(),
      createdAt: new Date().toISOString(),
      kind: "settings",
    });

    setActiveTab("Kasir");
    showToast(
      profileSynced
        ? "Pengaturan tersimpan"
        : "Profil tersimpan lokal; sinkronisasi Firebase gagal",
    );
  };

  const deleteSale = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const attemptedAt = new Date().toISOString();
    const attemptTime = formatNow();
    const hasPassword = Boolean(settings.deletePassword);
    const validPassword =
      hasPassword &&
      (await hashPassword(deleteInput)) === settings.deletePassword;

    if (!hasPassword || !validPassword) {
      await writeNotification({
        title: `Percobaan penghapusan data${hasPassword ? " (sandi salah)" : ""}`,
        text: `${target.product} · Modal ${money(target.cost)} · Jual ${money(target.price)} · Untung ${money(target.profit)}. Percobaan pada ${attemptTime}.`,
        time: attemptTime,
        createdAt: attemptedAt,
        kind: "delete-attempt",
      });
      setDeleteError(
        hasPassword
          ? "Sandi penghapusan salah."
          : "Atur sandi penghapusan di Pengaturan terlebih dahulu.",
      );
      return;
    }

    const deletedAt = new Date().toISOString();
    const deletedTime = formatNow();
    const docId = target.firestoreId || String(target.id);

    if (db) {
      try {
        await deleteDoc(doc(db, "users", user.uid, "sales", docId));
      } catch (error) {
        console.error("[webkita] Sale delete sync failed", error);
        setDeleteError("Penghapusan gagal disimpan. Coba lagi.");
        return;
      }
    }

    const nextSales = sales.filter(
      (sale) =>
        sale.id !== target.id &&
        (sale.firestoreId || String(sale.id)) !== docId,
    );
    setSales(nextSales);
    persistLocal(user.uid, undefined, nextSales);

    await writeNotification({
      title: "Transaksi dihapus",
      text: `${target.product} · Modal ${money(target.cost)} · Jual ${money(target.price)} · Untung ${money(target.profit)} · Waktu asli ${target.date} ${target.time} · Dihapus ${deletedTime} oleh ${user.email || "akun aktif"}.`,
      time: deletedTime,
      createdAt: deletedAt,
      kind: "delete-success",
    });

    setDeleteTarget(null);
    setDeleteInput("");
    setDeleteError("");
    showToast(`Transaksi ${target.product} dihapus`);
  };

  const recordSale = async (product: Product) => {
    if (product.stock <= 0) return;
    const now = new Date();
    const time = new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    const nextProduct = { ...product, stock: product.stock - 1 };
    const sale: Sale = {
      id: Date.now(),
      product: product.name,
      price: product.price,
      cost: product.cost,
      profit: product.price - product.cost,
      time,
      date: dateKey,
    };
    const nextProducts = products.map((item) =>
      item.id === product.id ? nextProduct : item,
    );
    const nextSales = [sale, ...sales];
    setProducts(nextProducts);
    setSales(nextSales);
    persistLocal(user.uid, nextProducts, nextSales);

    if (db) {
      try {
        const saleRef = await addDoc(
          collection(db, "users", user.uid, "sales"),
          { ...sale, createdAt: now.toISOString() },
        );
        // simpan firestoreId agar delete bisa menemukan dokumen
        setSales((items) => {
          const updated = items.map((s) =>
            s.id === sale.id ? { ...s, firestoreId: saleRef.id } : s,
          );
          persistLocal(user.uid, undefined, updated);
          return updated;
        });
        await setDoc(
          doc(db, "users", user.uid, "products", String(product.id)),
          nextProduct,
          { merge: true },
        );
      } catch (error) {
        console.error("[webkita] Sale sync failed", error);
        showToast("Transaksi tersimpan lokal; sinkronisasi Firebase gagal");
        await writeNotification({
          title: "Penjualan tercatat (lokal)",
          text: `${product.name} · ${money(product.price)} · Stok tersisa ${nextProduct.stock}. Sinkronisasi cloud gagal.`,
          time: formatNow(),
          createdAt: now.toISOString(),
          kind: "sale-local",
        });
        return;
      }
    }

    await writeNotification({
      title: "Penjualan tercatat",
      text: `${product.name} · Jual ${money(product.price)} · Modal ${money(product.cost)} · Untung ${money(sale.profit)} · Stok tersisa ${nextProduct.stock}.`,
      time: formatNow(),
      createdAt: now.toISOString(),
      kind: "sale",
    });
    showToast(`+1 ${product.name} berhasil dicatat`);
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.cost || !form.price || form.stock === "") {
      showToast("Lengkapi nama, modal, harga jual, dan stok");
      return;
    }
    const isEdit = Boolean(editing);
    const next: Product = {
      id: editing?.id ?? Date.now(),
      name: form.name.trim(),
      category: form.category,
      cost: Number(form.cost),
      price: Number(form.price),
      stock: Number(form.stock),
      active: editing?.active ?? true,
    };
    const nextProducts = editing
      ? products.map((item) => (item.id === editing.id ? next : item))
      : [...products, next];
    setProducts(nextProducts);
    persistLocal(user.uid, nextProducts);
    setShowProductForm(false);
    setEditing(null);
    setForm({ name: "", category: "Minuman", cost: "", price: "", stock: "" });

    if (db) {
      try {
        await setDoc(
          doc(db, "users", user.uid, "products", String(next.id)),
          next,
          { merge: true },
        );
      } catch (error) {
        console.error("[webkita] Product sync failed", error);
        showToast("Produk tersimpan lokal; sinkronisasi Firebase gagal");
      }
    }

    await writeNotification({
      title: isEdit ? "Produk diperbarui" : "Produk ditambahkan",
      text: `${next.name} · ${next.category} · Modal ${money(next.cost)} · Jual ${money(next.price)} · Stok ${next.stock}.`,
      time: formatNow(),
      createdAt: new Date().toISOString(),
      kind: isEdit ? "product-edit" : "product-add",
    });
    showToast("Produk tersimpan");
  };

  const logout = () => {
    if (auth) void signOut(auth);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showSidebar ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img
            src="/webkita-logo.png"
            alt="WebKita Kasir"
            className="brand-logo"
          />
          <button
            className="close-sidebar"
            onClick={() => setShowSidebar(false)}
            aria-label="Tutup menu"
          >
            <X />
          </button>
        </div>
        <div className="store-card">
          <div className="store-avatar">
            {settings.photoUrl ? (
              <img src={settings.photoUrl} alt="Foto profil" />
            ) : (
              initials
            )}
          </div>
          <div>
            <strong>{settings.business || "Profil belum diatur"}</strong>
            <span>{settings.branch || "Tambahkan alamat cabang"}</span>
          </div>
        </div>
        <nav>
          {[
            ["Kasir", LayoutDashboard],
            ["Riwayat Transaksi", ReceiptText],
            ["Produk", Package],
          ].map(([label, Icon]) => (
            <button
              key={label as string}
              className={`nav-item ${activeTab === label ? "active" : ""}`}
              onClick={() => {
                setActiveTab(label as string);
                setShowSidebar(false);
              }}
              data-tour={
                label === "Kasir"
                  ? "nav-kasir"
                  : label === "Produk"
                    ? "nav-produk"
                    : "nav-riwayat"
              }
            >
              <Icon />
              {label as string}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => {
              setActiveTab("Pengaturan");
              setShowSidebar(false);
            }}
            data-tour="nav-pengaturan"
          >
            <Settings />
            Pengaturan
          </button>
          <button className="nav-item" onClick={logout} aria-label="Keluar">
            <LogOut />
            Keluar
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setShowSidebar(true)}
            aria-label="Buka menu"
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            <strong>WebKita Kasir</strong>
            <span>/</span>
            <span>{activeTab}</span>
          </div>
          <div className="topbar-actions">
            <button
              className={`theme-toggle ${theme === "dark" ? "is-dark" : ""}`}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={`Aktifkan mode ${theme === "light" ? "gelap" : "terang"}`}
            >
              <span>{theme === "light" ? <Moon /> : <Sun />}</span>
              <i />
            </button>
            <button
              className="icon-button"
              onClick={() => setActiveTab("Pemberitahuan")}
              aria-label="Pemberitahuan"
              data-tour="btn-notif"
            >
              <Bell />
              {notifications.length > 0 && (
                <span className="notification-dot" />
              )}
            </button>
            <button
              className="profile-button"
              onClick={() => setActiveTab("Pengaturan")}
            >
              <span className="user-avatar">
                {settings.photoUrl ? (
                  <img src={settings.photoUrl} alt="Foto profil" />
                ) : (
                  initials
                )}
              </span>
              <span className="profile-name">
                {settings.business || "Admin toko"}
              </span>
              <ChevronRight />
            </button>
          </div>
        </header>

        {toast && (
          <div className="sale-toast" role="status">
            {toast}
          </div>
        )}

        <div className="page-wrap">
          {activeTab === "Pengaturan" ? (
            <SettingsPage
              draft={profileDraft}
              savedPassword={settings.deletePassword}
              setDraft={setProfileDraft}
              user={user}
              onSave={saveProfile}
              onLogout={logout}
            />
          ) : activeTab === "Pemberitahuan" ? (
            <NotificationPage notifications={notifications} />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <p className="eyebrow">
                    {new Intl.DateTimeFormat("id-ID", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }).format(new Date())}
                  </p>
                  <h1>
                    {activeTab === "Kasir"
                      ? `Selamat datang${settings.business ? `, ${settings.business}` : ""}`
                      : activeTab}
                  </h1>
                  <p className="subheading">
                    {settings.branch ||
                      "Lengkapi profil toko di Pengaturan untuk memulai."}
                  </p>
                </div>
                {activeTab === "Produk" && (
                  <button
                    className="primary-button"
                    onClick={() => setShowProductForm(true)}
                    data-tour="btn-tambah-produk"
                  >
                    <Plus />
                    Tambah Produk
                  </button>
                )}
              </section>

              {activeTab === "Kasir" && (
                <>
                  <section className="promo-banner">
                    <strong>Promo WebKita Kasir</strong>
                    <p>
                      Gratis 3 bulan pertama untuk 30 orang pertama. Setelahnya
                      Rp79.000/bulan atau Rp499.000/tahun.
                    </p>
                  </section>
                  <section className="stats-grid" data-tour="stats">
                    <StatCard
                      label="Omzet Hari Ini"
                      value={money(todayRevenue)}
                    />
                    <StatCard
                      label="Keuntungan Hari Ini"
                      value={money(todayProfit)}
                    />
                    <StatCard
                      label="Omzet Bulan Ini"
                      value={money(monthRevenue)}
                    />
                    <StatCard
                      label="Keuntungan Bulan Ini"
                      value={money(monthProfit)}
                    />
                  </section>
                  <section className="section-heading">
                    <div>
                      <h2>Produk Hari Ini</h2>
                      <p>
                        Tekan tombol <b>Terjual</b> setiap kali ada penjualan.
                      </p>
                    </div>
                  </section>
                  <section className="product-grid" data-tour="produk-grid">
                    {products
                      .filter((product) => product.active)
                      .map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          onSell={recordSale}
                        />
                      ))}
                    <button
                      className="add-product-card"
                      onClick={() => setShowProductForm(true)}
                    >
                      <span>
                        <Plus />
                      </span>
                      <strong>Tambah Produk</strong>
                      <small>Buat produk pertama</small>
                    </button>
                  </section>
                  <section className="recent-card">
                    <div className="card-heading">
                      <div>
                        <h2>Transaksi Terbaru</h2>
                        <p>
                          {todaySales.length
                            ? `${todaySales.length} transaksi hari ini`
                            : "Belum ada transaksi."}
                        </p>
                      </div>
                    </div>
                    <TransactionTable
                      sales={todaySales.slice(0, 4)}
                      onDelete={setDeleteTarget}
                    />
                  </section>
                </>
              )}

              {activeTab === "Riwayat Transaksi" && (
                <section className="recent-card full-card">
                  <div className="card-heading">
                    <div>
                      <h2>Semua Transaksi</h2>
                      <p>Riwayat transaksi toko.</p>
                    </div>
                    <div className="filter-actions">
                      <input
                        type="date"
                        value={filterDate}
                        onChange={(event) => setFilterDate(event.target.value)}
                        aria-label="Filter berdasarkan tanggal"
                      />
                      <button
                        className="primary-button"
                        onClick={() => {
                          const csv = [
                            [
                              "Produk",
                              "Harga Jual",
                              "Harga Modal",
                              "Keuntungan",
                              "Waktu",
                            ],
                            ...filteredSales.map((sale) => [
                              sale.product,
                              sale.price,
                              sale.cost,
                              sale.profit,
                              `${sale.date} ${sale.time}`,
                            ]),
                          ]
                            .map((row) => row.join(","))
                            .join("\n");
                          const link = document.createElement("a");
                          link.href = URL.createObjectURL(
                            new Blob([csv], { type: "text/csv" }),
                          );
                          link.download = "riwayat-webkita.csv";
                          link.click();
                          void writeNotification({
                            title: "Export CSV",
                            text: `${filteredSales.length} transaksi diekspor ke riwayat-webkita.csv.`,
                            time: formatNow(),
                            createdAt: new Date().toISOString(),
                            kind: "export",
                          });
                        }}
                      >
                        <Download />
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <TransactionTable
                    sales={filteredSales}
                    onDelete={setDeleteTarget}
                  />
                </section>
              )}

              {activeTab === "Produk" && (
                <ProductList
                  products={products}
                  setEditing={setEditing}
                  setForm={setForm}
                  setShowProductForm={setShowProductForm}
                />
              )}
            </>
          )}
        </div>
      </main>

      {deleteTarget && (
        <DeleteModal
          sale={deleteTarget}
          value={deleteInput}
          error={deleteError}
          setValue={setDeleteInput}
          onConfirm={deleteSale}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteInput("");
            setDeleteError("");
          }}
        />
      )}

      {showProductForm && (
        <ProductForm
          editing={editing}
          form={form}
          setForm={setForm}
          onSave={saveProduct}
          onClose={() => {
            setShowProductForm(false);
            setEditing(null);
            setForm({
              name: "",
              category: "Minuman",
              cost: "",
              price: "",
              stock: "",
            });
          }}
        />
      )}

      {showTour && (
        <ProductTour
          step={tourStep}
          setStep={setTourStep}
          onClose={() => {
            setShowTour(false);
            window.localStorage.setItem(`webkita-tour-${user.uid}`, "done");
          }}
        />
      )}
    </div>
  );
}

function AuthScreen({ mode, setMode, form, setForm, error, setError }: any) {
  const submit = async () => {
    if (!auth) {
      setError("Firebase belum siap.");
      return;
    }
    try {
      setError("");
      if (mode === "register") {
        const credential = await createUserWithEmailAndPassword(
          auth,
          form.email,
          form.password,
        );
        if (form.name)
          await updateProfile(credential.user, { displayName: form.name });
      } else await signInWithEmailAndPassword(auth, form.email, form.password);
    } catch (e: any) {
      setError(
        e.message?.replace("Firebase:", "").trim() ||
          "Email atau sandi tidak valid.",
      );
    }
  };
  const google = async () => {
    if (!auth) return setError("Firebase belum siap.");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      setError(e.message || "Login Google gagal.");
    }
  };
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img
          className="auth-logo"
          src="/webkita-logo.png"
          alt="WebKita Kasir"
        />
        <p className="eyebrow">WEBKITA KASIR</p>
        <h1>Kelola toko lebih mudah.</h1>
        <p>Catat penjualan UMKM cukup dengan satu klik.</p>
        <div className="auth-form">
          {mode === "register" && (
            <input
              placeholder="Nama lengkap"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            type="password"
            placeholder="Sandi"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button className="primary-button" onClick={submit}>
            {mode === "login" ? "Masuk" : "Daftar gratis"}
          </button>
          <button className="google-button" onClick={google}>
            Masuk dengan Google
          </button>
          {error && <small className="stock-warning">{error}</small>}
        </div>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "Belum punya akun? Daftar"
            : "Sudah punya akun? Masuk"}
        </button>
        <p className="promo-note">
          Gratis 3 bulan pertama untuk 30 orang pertama.
        </p>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  onSell,
}: {
  product: Product;
  onSell: (p: Product) => void;
}) {
  return (
    <div className={`product-card ${product.stock <= 3 ? "low-stock" : ""}`}>
      <div className="product-card-top">
        <div className="product-symbol">
          <ShoppingBag />
        </div>
        <span>{product.category}</span>
      </div>
      <h3>{product.name}</h3>
      <p>{money(product.price)}</p>
      <div className="profit-line">
        <span className={product.stock <= 3 ? "stock-warning" : ""}>
          {product.stock <= 3
            ? `Stok mau habis: ${product.stock}`
            : `Stok: ${product.stock}`}
        </span>
        <b>+{money(product.price - product.cost)}</b>
      </div>
      <button
        className="sell-button"
        onClick={() => onSell(product)}
        disabled={!product.stock}
        data-tour="btn-terjual"
      >
        Terjual <span>↗</span>
      </button>
    </div>
  );
}

function TransactionTable({
  sales,
  onDelete,
}: {
  sales: Sale[];
  onDelete: (sale: Sale) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Produk</th>
            <th>Jual</th>
            <th>Modal</th>
            <th>Untung</th>
            <th>Waktu</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {sales.length ? (
            sales.map((sale) => (
              <tr key={`${sale.firestoreId || sale.id}-${sale.date}-${sale.time}`}>
                <td>
                  <strong>{sale.product}</strong>
                </td>
                <td>{money(sale.price)}</td>
                <td>{money(sale.cost)}</td>
                <td className="profit-text">+{money(sale.profit)}</td>
                <td>
                  {sale.date} {sale.time}
                </td>
                <td>
                  <button
                    type="button"
                    className="delete-row-button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDelete(sale);
                    }}
                    aria-label={`Hapus transaksi ${sale.product}`}
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="empty-row">
                Belum ada transaksi.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DeleteModal({
  sale,
  value,
  error,
  setValue,
  onConfirm,
  onClose,
}: any) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
    >
      <div className="modal">
        <div className="modal-header">
          <h2 id="delete-title">Hapus transaksi?</h2>
          <button type="button" onClick={onClose} aria-label="Tutup">
            <X />
          </button>
        </div>
        <p>
          Transaksi <strong>{sale.product}</strong> pada {sale.date} {sale.time}{" "}
          akan dihapus.
        </p>
        <label>
          Sandi penghapusan
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
            }}
            placeholder="Masukkan sandi penghapusan"
          />
        </label>
        {error && <small className="stock-warning">{error}</small>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="logout-button" onClick={onConfirm}>
            Hapus transaksi
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductList({
  products,
  setEditing,
  setForm,
  setShowProductForm,
}: any) {
  return (
    <section className="recent-card full-card">
      <div className="card-heading">
        <div>
          <h2>Daftar Produk</h2>
          <p>Stok 3 atau kurang ditandai merah.</p>
        </div>
      </div>
      <div className="product-list">
        {products.length ? (
          products.map((product: Product) => (
            <div className="product-row" key={product.id}>
              <div className="product-symbol">
                <ShoppingBag />
              </div>
              <div className="product-info">
                <strong>{product.name}</strong>
                <span>
                  {product.category} · {money(product.price)}
                </span>
              </div>
              <strong className={product.stock <= 3 ? "stock-warning" : ""}>
                {product.stock <= 3
                  ? `Stok mau habis: ${product.stock}`
                  : `Stok: ${product.stock}`}
              </strong>
              <button
                className="edit-button"
                onClick={() => {
                  setEditing(product);
                  setForm({
                    name: product.name,
                    category: product.category,
                    cost: String(product.cost),
                    price: String(product.price),
                    stock: String(product.stock),
                  });
                  setShowProductForm(true);
                }}
                aria-label={`Edit ${product.name}`}
              >
                <Pencil />
              </button>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Package />
            <strong>Belum ada produk</strong>
            <span>Tambahkan produk untuk mulai mencatat penjualan.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ProductForm({ editing, form, setForm, onSave, onClose }: any) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>{editing ? "Edit Produk" : "Tambah Produk"}</h2>
          <button onClick={onClose} aria-label="Tutup">
            <X />
          </button>
        </div>
        <div className="form-grid">
          <label>
            Nama Produk
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Kategori
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option>Minuman</option>
              <option>Makanan</option>
              <option>Camilan</option>
              <option>Lainnya</option>
            </select>
          </label>
          <label>
            Harga Modal (HPP)
            <input
              type="number"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </label>
          <label>
            Harga Jual
            <input
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </label>
          <label>
            Stok
            <input
              type="number"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Batal</button>
          <button className="primary-button" onClick={onSave}>
            Simpan Produk
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({
  draft,
  savedPassword,
  setDraft,
  user,
  onSave,
  onLogout,
}: {
  draft: SettingsData;
  savedPassword: string;
  setDraft: (d: SettingsData) => void;
  user: User;
  onSave: (opts?: {
    newDeletePassword?: string;
    clearDeletePassword?: boolean;
  }) => Promise<void>;
  onLogout: () => void;
}) {
  const [referralOpen, setReferralOpen] = useState(Boolean(draft.referral));
  const [copied, setCopied] = useState("");
  const [oldDeletePassword, setOldDeletePassword] = useState("");
  const [newDeletePassword, setNewDeletePassword] = useState("");
  const [confirmDeletePassword, setConfirmDeletePassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const hasSavedPassword = Boolean(savedPassword);

  const uploadPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    if (!file.type.startsWith("image/")) {
      setPhotoError("File harus berupa gambar.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setPhotoError("Ukuran gambar maksimal 8 MB.");
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      setDraft({ ...draft, photoUrl: dataUrl });
    } catch {
      setPhotoError("Gagal memproses gambar. Coba file lain.");
    }
  };

  const referralCode =
    draft.referral || `WK-${user.uid.slice(0, 8).toUpperCase()}`;
  const referralLink = `${typeof window !== "undefined" ? window.location.origin : ""}?ref=${referralCode}`;

  const generateReferral = async () => {
    setDraft({ ...draft, referral: referralCode });
    setReferralOpen(true);
    if (db)
      await setDoc(
        doc(db, "users", user.uid),
        { referral: referralCode, referralCreatedAt: new Date().toISOString() },
        { merge: true },
      );
  };

  const copyReferral = async (value: string, label: string) => {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  };

  const handleSave = async () => {
    setPasswordError("");
    setSaving(true);
    try {
      const wantsChange =
        newDeletePassword.trim().length > 0 ||
        confirmDeletePassword.trim().length > 0;
      const wantsClear =
        hasSavedPassword &&
        oldDeletePassword.trim().length > 0 &&
        !newDeletePassword.trim() &&
        !confirmDeletePassword.trim() &&
        // user mengetik "hapus" di field lama saja? - tidak, clear hanya jika tombol khusus
        false;

      if (wantsChange) {
        if (newDeletePassword !== confirmDeletePassword) {
          setPasswordError("Konfirmasi sandi baru tidak cocok.");
          return;
        }
        if (newDeletePassword.length < 4) {
          setPasswordError("Sandi penghapusan minimal 4 karakter.");
          return;
        }
        if (hasSavedPassword) {
          if (!oldDeletePassword) {
            setPasswordError(
              "Masukkan sandi penghapusan lama untuk mengganti sandi.",
            );
            return;
          }
          const oldHash = await hashPassword(oldDeletePassword);
          if (oldHash !== savedPassword) {
            setPasswordError("Sandi penghapusan lama salah.");
            return;
          }
        }
        await onSave({ newDeletePassword });
        setOldDeletePassword("");
        setNewDeletePassword("");
        setConfirmDeletePassword("");
        return;
      }

      // tidak mengubah sandi
      await onSave();
      setOldDeletePassword("");
      setNewDeletePassword("");
      setConfirmDeletePassword("");
    } finally {
      setSaving(false);
    }
  };

  const handleClearPassword = async () => {
    setPasswordError("");
    if (!hasSavedPassword) return;
    if (!oldDeletePassword) {
      setPasswordError("Masukkan sandi penghapusan lama untuk menghapusnya.");
      return;
    }
    const oldHash = await hashPassword(oldDeletePassword);
    if (oldHash !== savedPassword) {
      setPasswordError("Sandi penghapusan lama salah.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ clearDeletePassword: true });
      setOldDeletePassword("");
      setNewDeletePassword("");
      setConfirmDeletePassword("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-page">
      <div className="settings-header">
        <div>
          <p className="eyebrow">AKUN & TOKO</p>
          <h1>Pengaturan</h1>
          <p className="subheading">
            Kelola identitas bisnis dan keamanan akunmu.
          </p>
        </div>
        <div className="settings-profile">
          <div className="user-avatar">
            {draft.photoUrl ? (
              <img src={draft.photoUrl} alt="Foto profil" />
            ) : (
              (draft.business || user.email || "WK").slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <strong>{user.email}</strong>
            <span>Akun aktif</span>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <div className="settings-icon">
              <Settings />
            </div>
            <div>
              <h2>Profil bisnis</h2>
              <p>Informasi yang tampil di dashboard.</p>
            </div>
          </div>
          <label>
            Nama bisnis
            <input
              value={draft.business}
              onChange={(e) => setDraft({ ...draft, business: e.target.value })}
              placeholder="Contoh: Kedai Kopi Kita"
            />
          </label>
          <label>
            Alamat cabang
            <input
              value={draft.branch}
              onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
              placeholder="Contoh: Jl. Merdeka No. 10"
            />
          </label>
          <label>
            Foto profil / logo toko
            <div className="photo-upload">
              <div className="profile-preview">
                {draft.photoUrl ? (
                  <img src={draft.photoUrl} alt="Foto profil" />
                ) : (
                  <Upload />
                )}
              </div>
              <input type="file" accept="image/*" onChange={uploadPhoto} />
            </div>
            {photoError && (
              <small className="stock-warning">{photoError}</small>
            )}
            <small style={{ color: "var(--muted)", fontSize: 11 }}>
              Gambar dikompres otomatis agar tetap bisa disimpan.
            </small>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <div className="settings-icon">
              <Share2 />
            </div>
            <div>
              <h2>Referral</h2>
              <p>Ajak teman dan dapatkan reward 25%.</p>
            </div>
          </div>
          <label>
            Masukkan Kode Referral
            <input
              value={draft.referral}
              onChange={(e) =>
                setDraft({ ...draft, referral: e.target.value.toUpperCase() })
              }
              placeholder="Contoh: WK-AB12CD34"
            />
          </label>
          <button
            className="primary-button referral-share-button"
            onClick={generateReferral}
          >
            <Share2 />
            Bagikan dengan Teman & Dapatkan 25%
          </button>
          {referralOpen && (
            <div className="referral-fields">
              <label>
                Link Bagikan
                <div className="copy-field">
                  <input readOnly value={referralLink} />
                  <button onClick={() => copyReferral(referralLink, "link")}>
                    Salin
                  </button>
                </div>
              </label>
              <label>
                Kode Referral
                <div className="copy-field">
                  <input readOnly value={referralCode} />
                  <button onClick={() => copyReferral(referralCode, "kode")}>
                    Salin
                  </button>
                </div>
              </label>
              {copied && (
                <small className="copy-success">
                  {copied === "link" ? "Link" : "Kode referral"} berhasil
                  disalin.
                </small>
              )}
            </div>
          )}

          <div className="settings-card-title" style={{ marginTop: 18 }}>
            <div className="settings-icon">
              <LogOut />
            </div>
            <div>
              <h2>Sandi penghapusan data</h2>
              <p>
                {hasSavedPassword
                  ? "Sandi sudah diatur. Untuk mengubah, masukkan sandi lama dulu."
                  : "Belum diatur. Buat sandi untuk melindungi penghapusan transaksi."}
              </p>
            </div>
          </div>

          {hasSavedPassword && (
            <label>
              Sandi penghapusan lama
              <input
                type="password"
                value={oldDeletePassword}
                onChange={(e) => setOldDeletePassword(e.target.value)}
                placeholder="Wajib diisi jika ingin ubah / hapus sandi"
                autoComplete="off"
              />
            </label>
          )}
          <label>
            {hasSavedPassword ? "Sandi penghapusan baru" : "Buat sandi penghapusan"}
            <input
              type="password"
              value={newDeletePassword}
              onChange={(e) => setNewDeletePassword(e.target.value)}
              placeholder={
                hasSavedPassword
                  ? "Kosongkan jika tidak ingin mengubah"
                  : "Minimal 4 karakter"
              }
              autoComplete="new-password"
            />
          </label>
          {(newDeletePassword || !hasSavedPassword) && (
            <label>
              Konfirmasi sandi penghapusan
              <input
                type="password"
                value={confirmDeletePassword}
                onChange={(e) => setConfirmDeletePassword(e.target.value)}
                placeholder="Ulangi sandi"
                autoComplete="new-password"
              />
            </label>
          )}
          {passwordError && (
            <small className="stock-warning">{passwordError}</small>
          )}

          <div className="settings-actions">
            <button
              className="primary-button"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Menyimpan..." : "Simpan Pengaturan"}
            </button>
            {hasSavedPassword && (
              <button
                type="button"
                className="logout-button"
                onClick={handleClearPassword}
                disabled={saving}
              >
                Hapus sandi penghapusan
              </button>
            )}
            <button className="logout-button" onClick={onLogout}>
              <LogOut />
              Keluar dari akun
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function NotificationPage({
  notifications,
}: {
  notifications: AppNotification[];
}) {
  return (
    <section className="notifications-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AKTIVITAS AKUN</p>
          <h1>Pemberitahuan</h1>
          <p className="subheading">
            Semua aktivitas penting toko dan akunmu, tersusun berdasarkan waktu.
          </p>
        </div>
      </div>
      <section className="notifications-card">
        {notifications.length ? (
          notifications.map((item) => (
            <article className="notification-full-item" key={item.id}>
              <div className="notification-icon">
                <Bell />
              </div>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
                <time>{item.time}</time>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <Bell />
            <strong>Belum ada pemberitahuan</strong>
            <span>Notifikasi aktivitas toko akan muncul di sini.</span>
          </div>
        )}
      </section>
    </section>
  );
}

function ProductTour({
  step,
  setStep,
  onClose,
}: {
  step: number;
  setStep: (n: number) => void;
  onClose: () => void;
}) {
  const steps = [
    {
      title: "Selamat datang di WebKita Kasir",
      text: "Ini tour singkat. Semua data toko dimulai dari kosong agar kamu bisa mengatur sendiri.",
    },
    {
      title: "Menu Kasir",
      text: "Di sini kamu melihat omzet, keuntungan, dan menekan tombol Terjual setiap ada penjualan.",
    },
    {
      title: "Tambahkan produk",
      text: "Buka menu Produk, lalu isi nama, harga modal, harga jual, dan stok. Produk akan muncul di Kasir.",
    },
    {
      title: "Riwayat & hapus transaksi",
      text: "Semua penjualan tercatat di Riwayat. Tombol Hapus dilindungi sandi penghapusan di Pengaturan.",
    },
    {
      title: "Pengaturan & logo",
      text: "Isi nama toko, alamat, upload logo/foto, dan buat sandi penghapusan. Logo akan muncul di sidebar dan profil.",
    },
    {
      title: "Pemberitahuan",
      text: "Setiap penjualan, ubah produk, simpan pengaturan, export, dan percobaan hapus muncul di sini.",
    },
  ];
  const item = steps[step] || steps[0];
  return (
    <div className="tour-backdrop">
      <div className="tour-card">
        <span className="tour-step">
          LANGKAH {step + 1} DARI {steps.length}
        </span>
        <h2>{item.title}</h2>
        <p>{item.text}</p>
        <div className="tour-actions">
          <button type="button" onClick={onClose}>
            Lewati
          </button>
          {step < steps.length - 1 ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => setStep(step + 1)}
            >
              Lanjut
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onClose}>
              Mulai
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>Periode berjalan</small>
    </div>
  );
}
