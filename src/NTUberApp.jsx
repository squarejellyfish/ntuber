import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers'; // 標準 NPM 導入
import L from 'leaflet';         // 標準 NPM 導入
import 'leaflet/dist/leaflet.css'; // 直接導入 CSS
import { 
  MapPin, 
  Navigation, 
  Bike, 
  Star, 
  User, 
  Clock, 
  ShieldCheck, 
  Wallet, 
  Menu,
  ChevronLeft,
  Crosshair,
  List,
  Loader2, 
  XCircle,
  History
} from 'lucide-react';

/**
 * NTUber DApp - Local Development Version (Fixed)
 * * 更新：
 * 1. 新增「跳過評價」邏輯：使用 localStorage 記錄跳過的訂單。
 * 2. 重整頁面後，若已跳過評價，不會再自動彈出評價視窗。
 * 3. 仍可從「我的行程」中手動進行評價。
 */

// --- 合約設定 ---
const CONTRACT_ADDRESS = "0xa5a5d38a99dcd0863C62347337Bf90093A54eFeE";
const SEPOLIA_CHAIN_ID = '0xaa36a7'; 
const ETH_TO_NTD_RATE = 100000; // 匯率設定 (1 ETH = 100,000 NTD)

const CONTRACT_ABI = [
  "function requestRide(string memory _pickup, string memory _dropoff) public payable",
  "function acceptRide(uint256 _rideId) public",
  "function startRide(uint256 _rideId) public",
  "function completeRide(uint256 _rideId) public",
  "function cancelRide(uint256 _rideId) public", 
  "function rateDriver(uint256 _rideId, uint8 _rating) public",
  "function rideCount() public view returns (uint256)",
  "function getRideDetails(uint256 _rideId) public view returns (tuple(uint256 id, address passenger, address driver, string pickupLocation, string dropoffLocation, uint256 amount, uint256 timestamp, uint8 status, bool isRated, uint8 rating))",
  "event RideRequested(uint256 indexed rideId, address indexed passenger, uint256 amount, string pickup)",
  "event RideAccepted(uint256 indexed rideId, address indexed driver)",
  "event RideStarted(uint256 indexed rideId)",
  "event RideCompleted(uint256 indexed rideId, address indexed driver, uint256 amount)",
  "event RideCancelled(uint256 indexed rideId, address indexed triggerBy)", 
  "event DriverRated(address indexed driver, uint8 rating)"
];

const NTUberApp = () => {
  // --- 狀態管理 ---
  const [role, setRole] = useState('passenger');
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState('0.00'); 
  const [appState, setAppState] = useState('IDLE'); 
  
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);

  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [dropoffCoords, setDropoffCoords] = useState(null);
  const [activeField, setActiveField] = useState(null);
  const [estimatedPrice, setEstimatedPrice] = useState(0.001); 
  const [driverCoords, setDriverCoords] = useState(null); // 新增：司機位置狀態
  const [userLocation, setUserLocation] = useState(null); // 新增：使用者位置
  const [selectedRideType, setSelectedRideType] = useState('NTUber Bike');
  
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(''); 

  const [allRides, setAllRides] = useState([]); 
  const [myCurrentRide, setMyCurrentRide] = useState(null);
  const [previewRide, setPreviewRide] = useState(null); 

  // 新增：記錄跳過評價的訂單 ID (從 localStorage 初始化)
  const [skippedRideIds, setSkippedRideIds] = useState(() => {
    const saved = localStorage.getItem('ntuber_skipped_ratings');
    return saved ? JSON.parse(saved) : [];
  });

  // 當 skippedRideIds 變更時，同步到 localStorage
  useEffect(() => {
    localStorage.setItem('ntuber_skipped_ratings', JSON.stringify(skippedRideIds));
  }, [skippedRideIds]);

  // --- 輔助功能 ---
  const parseLocation = (locString) => {
    try {
      return JSON.parse(locString);
    } catch (e) {
      return { name: locString, lat: 25.0174, lng: 121.5397 };
    }
  };

  // 匯率轉換 helper
  const toNTD = (ethValue) => {
    const val = parseFloat(ethValue);
    return isNaN(val) ? '0' : Math.floor(val * ETH_TO_NTD_RATE).toLocaleString();
  };

  // 距離計算 helper (Haversine formula)
  const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3; // meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  };

  // 自動計算價格
  useEffect(() => {
    if (pickupCoords && dropoffCoords) {
      const dist = getDistanceMeters(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
      let priceNTD = 0;
      if (dist <= 500) priceNTD = 20;
      else if (dist <= 1000) priceNTD = 30;
      else priceNTD = 40 + Math.ceil((dist - 1000) / 100) * 5;

      // 轉換為 ETH (保留5位小數)
      setEstimatedPrice((priceNTD / ETH_TO_NTD_RATE).toFixed(5));
    }
  }, [pickupCoords, dropoffCoords]);

  // --- 真實位置同步邏輯 (LocalStorage 用於跨分頁通訊) ---
  useEffect(() => {
    // 若無進行中行程，清除司機位置
    if (!myCurrentRide || !['Accepted', 'Ongoing'].includes(myCurrentRide.status)) {
      setDriverCoords(null);
      return;
    }

    const rideId = myCurrentRide.id;
    const storageKey = `ntuber_driver_location_${rideId}`;

    if (role === 'driver') {
      // --- 司機端：獲取 GPS 並廣播 ---
      if (!navigator.geolocation) return;

      const geoId = navigator.geolocation.watchPosition(
        (position) => {
          const coords = { 
            lat: position.coords.latitude, 
            lng: position.coords.longitude 
          };
          setDriverCoords(coords); // 更新本地顯示
          localStorage.setItem(storageKey, JSON.stringify(coords)); // 廣播給乘客
        },
        (err) => console.error("位置獲取失敗:", err),
        { enableHighAccuracy: true, maximumAge: 0 }
      );

      return () => navigator.geolocation.clearWatch(geoId);

    } else {
      // --- 乘客端：監聽位置更新 ---
      const syncLocation = () => {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          try {
            setDriverCoords(JSON.parse(stored));
          } catch (e) { console.error(e); }
        }
      };

      syncLocation(); // 初始讀取
      const intervalId = setInterval(syncLocation, 1000); // 輪詢
      return () => clearInterval(intervalId);
    }
  }, [myCurrentRide, role]);

  // --- 定位功能 ---
  const handleLocateMe = () => {
    if (!navigator.geolocation) return alert("您的瀏覽器不支援地理定位");
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
      },
      (error) => console.error("Error getting location:", error)
    );
  };

  const statusMap = ['Created', 'Accepted', 'Ongoing', 'Completed', 'Cancelled'];

  const switchNetwork = async () => {
    if (!window.ethereum) return;
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== SEPOLIA_CHAIN_ID) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
      }
    } catch (error) {
      console.error("Failed to switch network:", error);
      alert("請務必切換至 Sepolia 測試網！");
    }
  };

  // --- 初始化 ---
  useEffect(() => {
    const initWeb3 = async () => {
      if (window.ethereum) {
        try {
          await switchNetwork();

          const _provider = new ethers.BrowserProvider(window.ethereum);
          const _signer = await _provider.getSigner();
          const _address = await _signer.getAddress();
          const _balance = await _provider.getBalance(_address);
          
          setProvider(_provider);
          setSigner(_signer);
          setWalletAddress(_address);
          setBalance(parseFloat(ethers.formatEther(_balance)).toFixed(4));

          const _contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, _signer);
          setContract(_contract);

          fetchRides(_contract);
          setupEventListeners(_contract, _address);

          window.ethereum.on('chainChanged', () => {
            window.location.reload();
          });

        } catch (err) {
          console.error("連接錢包失敗:", err);
          alert("請連接 Metamask 以使用此 DApp");
        }
      } else {
        alert("未檢測到錢包！請安裝 Metamask。");
      }
    };

    initWeb3();
    
    return () => {
      if (contract) contract.removeAllListeners();
    };
  }, []); 

  // --- 數據與事件 ---
  const fetchRides = async (_contract) => {
    try {
      const countBigInt = await _contract.rideCount();
      const count = Number(countBigInt);
      const rides = [];
      const start = count > 20 ? count - 20 : 1;
      
      for (let i = count; i >= start; i--) {
        const ride = await _contract.getRideDetails(i);
        const pickupData = parseLocation(ride.pickupLocation);
        const dropoffData = parseLocation(ride.dropoffLocation);
        
        rides.push({
          id: Number(ride.id),
          passenger: ride.passenger,
          driver: ride.driver === ethers.ZeroAddress ? null : ride.driver,
          amount: ethers.formatEther(ride.amount),
          status: statusMap[Number(ride.status)],
          pickup: pickupData.name,
          dropoff: dropoffData.name,
          pickupCoords: { lat: pickupData.lat, lng: pickupData.lng },
          dropoffCoords: { lat: dropoffData.lat, lng: dropoffData.lng },
          isRated: ride.isRated,
          timestamp: Number(ride.timestamp)
        });
      }
      setAllRides(rides);
    } catch (err) {
      console.error("讀取訂單失敗:", err);
    }
  };

  const setupEventListeners = (_contract, myAddress) => {
    const refresh = () => fetchRides(_contract);
    _contract.on("RideRequested", refresh);
    _contract.on("RideAccepted", refresh);
    _contract.on("RideStarted", refresh);
    _contract.on("RideCompleted", refresh);
    _contract.on("RideCancelled", refresh);
    _contract.on("DriverRated", refresh);
  };

  useEffect(() => {
    if (!walletAddress || allRides.length === 0) return;

    const myRides = allRides.filter(r => 
      (r.passenger.toLowerCase() === walletAddress.toLowerCase() || 
       (r.driver && r.driver.toLowerCase() === walletAddress.toLowerCase()))
    );

    const activeRide = myRides.sort((a, b) => b.id - a.id)[0];
    
    if (appState === 'HISTORY' || appState === 'RATING') return;

    if (activeRide && ['Created', 'Accepted', 'Ongoing'].includes(activeRide.status)) {
      setMyCurrentRide(activeRide);
      
      if (activeRide.status === 'Created') {
        if (role === 'passenger') setAppState('WAITING_DRIVER');
      } else if (activeRide.status === 'Accepted') {
        setAppState('DRIVER_EN_ROUTE');
      } else if (activeRide.status === 'Ongoing') {
        setAppState('IN_TRIP');
      }
    } else if (
        activeRide && 
        activeRide.status === 'Completed' && 
        !activeRide.isRated && 
        role === 'passenger' &&
        !skippedRideIds.includes(activeRide.id) // 修改：檢查是否已跳過
    ) {
        setMyCurrentRide(activeRide);
        setAppState('RATING');
    } else if (activeRide && activeRide.status === 'Cancelled') {
        if (['WAITING_DRIVER', 'DRIVER_EN_ROUTE'].includes(appState)) {
             resetApp();
        }
    }
  }, [allRides, walletAddress, role, skippedRideIds]); // 加入 skippedRideIds 依賴

  // --- 合約交互 ---
  const handleRequestRide = async () => {
    if (!pickup || !dropoff || !contract) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('請在錢包中確認交易...');
      
      const pickupData = JSON.stringify({ name: pickup, lat: pickupCoords.lat, lng: pickupCoords.lng });
      const dropoffData = JSON.stringify({ name: dropoff, lat: dropoffCoords.lat, lng: dropoffCoords.lng });
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.requestRide(pickupData, dropoffData, {
        value: ethers.parseEther(estimatedPrice.toString())
      });
      
      setLoadingMsg('交易廣播中，等待區塊確認...');
      await tx.wait(); 
      
      setLoading(false);
      setAppState('WAITING_DRIVER');
    } catch (err) {
      console.error(err);
      if (err.code === "ACTION_REJECTED") {
         alert("您取消了交易");
      } else {
         alert("交易失敗: " + (err.reason || err.message));
      }
      setLoading(false);
    }
  };

  const handleAcceptRide = (rideId) => {
    if (!contract) return;

    const executeAccept = async () => {
      try {
        await switchNetwork();
        setLoading(true);
        setLoadingMsg('正在接單...');
        
        const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
        const contractWithSigner = contract.connect(currentSigner);
        
        const tx = await contractWithSigner.acceptRide(rideId);
        await tx.wait();
        setLoading(false);
      } catch (err) {
        console.error(err);
        alert("接單失敗: " + (err.reason || err.message));
        setLoading(false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          executeAccept();
        },
        (error) => {
          console.error("Location error:", error);
          alert("需允許位置存取才能接單 (供乘客追蹤)");
        }
      );
    } else {
      alert("瀏覽器不支援定位");
    }
  };

  const handleStartRide = async () => {
    if (!contract || !myCurrentRide) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('更新行程狀態...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.startRide(myCurrentRide.id);
      await tx.wait();
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleCompleteRide = async () => {
    if (!contract || !myCurrentRide) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('確認到達並釋放資金...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.completeRide(myCurrentRide.id);
      await tx.wait();
      setLoading(false);
      setAppState('RATING');
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleCancelRide = async (rideId = null) => {
    const targetId = rideId || myCurrentRide?.id;
    if (!contract || !targetId) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('正在取消訂單並退款...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.cancelRide(targetId);
      await tx.wait();
      
      setLoading(false);
      alert("訂單已取消，資金已退回您的錢包。");
      
      if (appState !== 'HISTORY') {
        resetApp();
      }
    } catch (err) {
      console.error(err);
      alert("取消失敗: " + (err.reason || err.message));
      setLoading(false);
    }
  };

  const handleRateDriver = async (stars) => {
    if (!contract || !myCurrentRide) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('提交評價上鏈...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.rateDriver(myCurrentRide.id, stars);
      await tx.wait();
      
      alert(`評價成功！交易雜湊: ${tx.hash}`);
      resetApp();
    } catch (err) {
      console.error(err);
      resetApp();
    } finally {
      setLoading(false);
    }
  };

  // 新增：處理跳過評價
  const handleSkipRating = () => {
    if (myCurrentRide) {
      setSkippedRideIds(prev => [...prev, myCurrentRide.id]);
    }
    resetApp();
  };

  const resetApp = () => {
    setAppState('IDLE');
    setPickup('');
    setDropoff('');
    setPickupCoords(null);
    setDropoffCoords(null);
    setMyCurrentRide(null);
    setPreviewRide(null); 
    setEstimatedPrice(0.001);
  };

  const parseJsonSafe = (str) => {
    try { return JSON.parse(str); } catch (e) { return null; }
  };

  // --- 真實反向地理編碼 (Nominatim API) ---
  const fetchAddress = async (lat, lng) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-TW`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Geocoding failed");
      const data = await response.json();
      
      if (data.name) return data.name;
      
      const addr = data.address || {};
      const road = addr.road || addr.pedestrian || addr.suburb || "";
      const houseNumber = addr.house_number || "";
      
      if (road) return `${road}${houseNumber}`;
      
      return data.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (e) {
      console.error("Geocoding Error:", e);
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  };

  const handleMapClick = async (lat, lng) => {
    if (appState !== 'IDLE') return;
    
    const placeholder = "讀取地址中...";

    if (activeField === 'pickup' || !activeField) {
      setPickup(placeholder);
      setPickupCoords({ lat, lng });
      const address = await fetchAddress(lat, lng);
      setPickup(address);
      if (!activeField) setActiveField('dropoff');
    } else if (activeField === 'dropoff') {
      setDropoff(placeholder);
      setDropoffCoords({ lat, lng });
      const address = await fetchAddress(lat, lng);
      setDropoff(address);
      setActiveField(null);
    }
  };

  // --- 地圖元件 ---
  const LeafletMap = ({ pickupCoords, dropoffCoords, currentRide, previewRide, onMapClick, driverCoords, userLocation }) => {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markersRef = useRef([]);
    const routingLineRef = useRef(null);
    const NTU_COORDS = [25.0174, 121.5397];

    useEffect(() => {
      if (!mapInstanceRef.current && mapRef.current) {
        const map = L.map(mapRef.current, {
          center: NTU_COORDS,
          zoom: 16,
          zoomControl: false, 
          attributionControl: false
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
        map.on('click', (e) => onMapClick(e.latlng.lat, e.latlng.lng));
        mapInstanceRef.current = map;
      }
    }, []);

    useEffect(() => {
      if (!mapInstanceRef.current) return;
      const map = mapInstanceRef.current;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      if (routingLineRef.current) { routingLineRef.current.remove(); routingLineRef.current = null; }

      const createIcon = (color) => L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      const targetRide = currentRide || previewRide; // 優先顯示當前行程
      
      const pCoords = targetRide?.pickupCoords || pickupCoords;
      const dCoords = targetRide?.dropoffCoords || dropoffCoords;

      if (pCoords) {
        L.marker([pCoords.lat, pCoords.lng], { icon: createIcon('black') }).addTo(map).bindPopup("上車點");
      }
      if (dCoords) {
        L.marker([dCoords.lat, dCoords.lng], { icon: createIcon('gray') }).addTo(map).bindPopup("目的地");
      }
      if (pCoords && dCoords) {
        const latlngs = [[pCoords.lat, pCoords.lng], [dCoords.lat, dCoords.lng]];
        const polyline = L.polyline(latlngs, { color: 'black', weight: 3, dashArray: '5, 10' }).addTo(map);
        routingLineRef.current = polyline;
        map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      } else if (pCoords) {
        map.panTo([pCoords.lat, pCoords.lng]);
      }

      if (driverCoords) {
        const carIcon = L.divIcon({
          className: 'car-icon',
          html: `<div style="background: black; color: white; padding: 4px; border-radius: 4px; font-size: 10px; display: flex; align-items: center; justify-content: center;">BIKE</div>`,
          iconSize: [30, 20]
        });
        L.marker([driverCoords.lat, driverCoords.lng], { icon: carIcon, zIndexOffset: 1000 }).addTo(map);
      }

      if (userLocation) {
        const userIcon = L.divIcon({
          className: 'user-dot',
          html: `<div style="background-color: #3b82f6; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });
        L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 500 }).addTo(map).bindPopup("您的位置");
        
        if (!currentRide && !previewRide && !pickupCoords) map.panTo([userLocation.lat, userLocation.lng]);
      }
    }, [pickupCoords, dropoffCoords, currentRide, previewRide, driverCoords, userLocation]);
    return <div ref={mapRef} className="absolute inset-0 z-0" />;
  };

  // --- UI 元件 ---
  
  const Header = () => {
    const handleMenuClick = () => {
      if (appState === 'IDLE') {
        setAppState('HISTORY'); 
      } else if (appState === 'HISTORY') {
        setAppState('IDLE'); 
      } else {
        if (confirm('確定要取消並返回嗎？')) resetApp();
      }
    };

    const isRoleLocked = ['WAITING_DRIVER', 'DRIVER_EN_ROUTE', 'IN_TRIP', 'RATING'].includes(appState);

    return (
      <div className="w-full bg-white p-4 border-b border-gray-100 flex flex-col space-y-3 z-30">
        <div className="flex justify-between items-center">
          <button 
            onClick={handleMenuClick}
            className="bg-gray-100 p-2 rounded-full hover:bg-gray-200 transition"
          >
            {appState === 'IDLE' ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
          
          <div className="bg-gray-100 p-1 rounded-full flex text-sm relative group">
            <button 
              onClick={() => !isRoleLocked && setRole('passenger')} 
              disabled={isRoleLocked}
              className={`px-3 py-1 rounded-full transition ${role === 'passenger' ? 'bg-black text-white' : 'text-gray-500'} ${isRoleLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              乘客
            </button>
            <button 
              onClick={() => !isRoleLocked && setRole('driver')} 
              disabled={isRoleLocked}
              className={`px-3 py-1 rounded-full transition ${role === 'driver' ? 'bg-black text-white' : 'text-gray-500'} ${isRoleLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              司機
            </button>
            {isRoleLocked && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-32 bg-black text-white text-[10px] p-1 rounded opacity-0 group-hover:opacity-100 transition pointer-events-none text-center">
                行程中無法切換角色
              </div>
            )}
          </div>
        </div>
        
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center space-x-1 bg-green-50 text-green-700 px-2 py-1 rounded">
            <Wallet size={12} />
            <span className="font-mono">{balance} ETH <span className="text-gray-500 opacity-75">(≈NT${toNTD(balance)})</span></span>
          </div>
          <div className="text-gray-400">
            {walletAddress ? `${walletAddress.substring(0, 6)}...` : '未連接'}
          </div>
        </div>
      </div>
    );
  };

  const LoadingOverlay = () => (
    <div className="absolute inset-0 bg-black/50 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
      <Loader2 className="animate-spin mb-4" size={48} />
      <p className="font-bold text-lg">{loadingMsg || '區塊鏈確認中...'}</p>
      <p className="text-sm opacity-80 mt-2">請勿關閉瀏覽器</p>
    </div>
  );

  const renderHistoryView = () => {
    const myHistory = allRides.filter(r => 
      r.passenger.toLowerCase() === walletAddress.toLowerCase() || 
      (r.driver && r.driver.toLowerCase() === walletAddress.toLowerCase())
    ).sort((a, b) => b.id - a.id); 

    return (
      <div className="flex-grow flex flex-col h-full bg-white">
        <div className="flex justify-between items-center p-4 border-b">
            <h2 className="text-xl font-bold flex items-center"><History className="mr-2" size={20}/> 我的行程</h2>
            <button onClick={() => setAppState('IDLE')} className="p-1.5 bg-gray-100 rounded-full hover:bg-gray-200"><XCircle size={18}/></button>
        </div>
        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {myHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-400"><p>尚無行程紀錄</p></div>
          ) : (
            myHistory.map((ride) => (
              <div key={ride.id} className="border border-gray-100 bg-gray-50 p-3 rounded-xl shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-gray-800">#{ride.id}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      ride.status === 'Completed' ? 'bg-green-100 text-green-700' :
                      ride.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                      ride.status === 'Created' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{ride.status}</span>
                  </div>
                <span className="font-mono text-xs text-right">{ride.amount} ETH<br/><span className="text-gray-400">≈ NT${toNTD(ride.amount)}</span></span>
                </div>
                <div className="space-y-1 text-xs text-gray-600 mb-3">
                  <div className="flex items-center"><MapPin size={10} className="mr-1"/> {ride.pickup}</div>
                  <div className="flex items-center"><Navigation size={10} className="mr-1"/> {ride.dropoff}</div>
                  {ride.timestamp > 0 && (
                    <div className="flex items-center text-gray-400 mt-1">
                      <Clock size={10} className="mr-1"/> {new Date(ride.timestamp * 1000).toLocaleString()}
                    </div>
                  )}
                </div>
                {['Created', 'Accepted'].includes(ride.status) && ride.passenger.toLowerCase() === walletAddress.toLowerCase() && (
                  <button 
                    onClick={() => handleCancelRide(ride.id)} 
                    disabled={loading}
                    className="w-full mt-1 bg-white border border-red-200 text-red-600 py-1.5 rounded text-xs font-bold hover:bg-red-50 flex items-center justify-center"
                  >
                    <XCircle size={12} className="mr-1"/> 取消 (退款)
                  </button>
                )}
                {/* 即使跳過評價，這裡仍可手動點擊評價 */}
                {ride.status === 'Completed' && !ride.isRated && ride.passenger.toLowerCase() === walletAddress.toLowerCase() && (
                  <button 
                    onClick={() => { setMyCurrentRide(ride); setAppState('RATING'); }} 
                    className="w-full mt-1 bg-black text-white py-1.5 rounded text-xs font-bold hover:opacity-90"
                  >
                    前往評價
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderPassengerView = () => {
    if (appState === 'HISTORY') return renderHistoryView();

    if (appState === 'IDLE') {
      return (
        <div className="flex-grow flex flex-col p-6 overflow-y-auto">
          <h2 className="text-2xl font-bold mb-4">想去哪裡？</h2>
          <p className="text-xs text-gray-500 mb-4 flex items-center">
            <Crosshair size={12} className="mr-1"/> 請輸入地點或點選地圖
          </p>
          <div className="space-y-4 mb-6">
            <div className="relative">
              <div className={`absolute left-4 top-3.5 w-2 h-2 rounded-full transition-colors ${activeField === 'pickup' ? 'bg-blue-500 scale-125' : 'bg-black'}`}></div>
              <div className="absolute left-5 top-6 w-0.5 h-8 bg-gray-300"></div>
              <input type="text" placeholder="輸入上車地點" value={pickup} onFocus={() => setActiveField('pickup')} onChange={(e) => setPickup(e.target.value)} className="w-full bg-gray-100 p-3 pl-10 rounded-lg focus:outline-none border-2 font-medium transition-colors border-transparent focus:border-black focus:bg-white" />
            </div>
            <div className="relative">
              <div className={`absolute left-4 top-3.5 w-2 h-2 transition-colors ${activeField === 'dropoff' ? 'bg-blue-500 scale-125' : 'bg-black'}`}></div>
              <input type="text" placeholder="輸入目的地" value={dropoff} onFocus={() => setActiveField('dropoff')} onChange={(e) => setDropoff(e.target.value)} className="w-full bg-gray-100 p-3 pl-10 rounded-lg focus:outline-none border-2 font-medium transition-colors border-transparent focus:border-black focus:bg-white" />
            </div>
          </div>
          {pickup && dropoff && (
            <div className="space-y-3 mb-6">
              <div onClick={() => { setSelectedRideType('NTUber Bike'); }} className={`flex justify-between items-center p-3 rounded-xl border-2 cursor-pointer transition ${selectedRideType === 'NTUber Bike' ? 'border-black bg-gray-50' : 'border-transparent hover:bg-gray-50'}`}>
                <div className="flex items-center space-x-3">
                  <div className="bg-gray-200 p-2 rounded-full"><Bike size={24} className="text-gray-700" /></div>
                  <div><div className="font-bold text-lg">NTUber Bike</div><div className="text-xs text-gray-500">環保出行</div></div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-lg">{estimatedPrice} ETH</div>
                  <div className="text-sm text-gray-500">≈ NT${toNTD(estimatedPrice)}</div>
                </div>
              </div>
            </div>
          )}
          <button onClick={handleRequestRide} disabled={!pickup || !dropoff || loading} className="w-full bg-black text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:cursor-not-allowed mt-auto">
            {loading ? '處理中...' : '確認叫車'}
          </button>
        </div>
      );
    }

    if (appState === 'WAITING_DRIVER') {
      return (
        <div className="flex-grow flex flex-col p-6 items-center justify-center text-center">
          <div className="animate-pulse mb-4"><div className="bg-gray-100 p-4 rounded-full"><Navigation size={48} className="text-black animate-spin-slow" /></div></div>
          <h3 className="text-xl font-bold mb-2">訂單已上鏈！</h3>
          <p className="text-gray-500 mb-6">等待司機接單...</p>
          <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden mb-6"><div className="bg-black h-full w-2/3 animate-indeterminate"></div></div>
          <button onClick={() => handleCancelRide(null)} disabled={loading} className="text-red-500 font-bold underline hover:text-red-700 flex items-center justify-center">
             <XCircle size={16} className="mr-1"/> 取消並退款
          </button>
        </div>
      );
    }
    if (appState === 'DRIVER_EN_ROUTE' || appState === 'IN_TRIP') return renderActiveRideView();
    if (appState === 'RATING') return renderRatingView();
  };

  const renderDriverView = () => {
    if (appState === 'HISTORY') return renderHistoryView();
    if (myCurrentRide && ['Accepted', 'Ongoing'].includes(myCurrentRide.status)) return renderActiveRideView();
    return (
      <div className="flex-grow flex flex-col h-full bg-white">
        <div className="flex justify-between items-center p-4 border-b bg-gray-50">
          <div><h2 className="text-lg font-bold flex items-center"><List className="mr-2" size={20}/> 訂單池</h2><span className="text-[10px] text-gray-400">Sepolia Live Feed</span></div>
          <div className="flex items-center space-x-1 bg-black text-white px-2 py-0.5 rounded-full text-xs"><div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div><span>上線</span></div>
        </div>
        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {allRides.filter(r => r.status === 'Created').length === 0 ? (
            <div className="text-center py-12 text-gray-400"><p>目前無待處理訂單</p></div>
          ) : (
            allRides.filter(r => r.status === 'Created').map((ride) => (
              <div 
                key={ride.id} 
                onClick={() => setPreviewRide(ride)}
                className={`border-2 p-4 rounded-xl shadow-sm transition relative cursor-pointer ${previewRide?.id === ride.id ? 'border-black bg-gray-50' : 'border-gray-100 bg-white hover:border-gray-300'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center space-x-2"><div className="bg-gray-100 p-1 rounded-full"><User size={12}/></div><span className="font-bold text-gray-600">#{ride.id}</span></div>
                  <div className="text-right">
                    <div className="font-bold text-green-600">{ride.amount} ETH</div>
                    <div className="text-xs text-gray-400">≈ NT${toNTD(ride.amount)}</div>
                  </div>
                </div>
                <div className="space-y-2 text-xs text-gray-700 mb-3">
                  <div className="flex items-start space-x-2"><div className="w-1.5 h-1.5 bg-black rounded-full mt-1 flex-shrink-0"></div><span className="break-words">{ride.pickup}</span></div>
                  <div className="flex items-start space-x-2"><div className="w-1.5 h-1.5 bg-gray-400 mt-1 flex-shrink-0"></div><span className="break-words">{ride.dropoff}</span></div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleAcceptRide(ride.id); }} 
                  disabled={loading} 
                  className="w-full bg-black text-white py-2 rounded-lg font-bold shadow hover:opacity-90 disabled:opacity-50 text-sm"
                >
                  {loading ? '處理中...' : '接單'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderActiveRideView = () => {
    const isDriver = role === 'driver';
    const title = appState === 'DRIVER_EN_ROUTE' ? (isDriver ? '前往接送' : '司機趕來中') : '行程進行中';
    const canCancel = appState === 'DRIVER_EN_ROUTE';

    return (
      <div className="flex-grow flex flex-col h-full bg-white">
        <div className="bg-black text-white p-4 text-center font-bold flex justify-between items-center relative">
          <div className="w-full text-center">{title}</div>
          {canCancel && (
            <button onClick={() => handleCancelRide(null)} disabled={loading} className="absolute right-4 text-xs bg-red-600 px-2 py-1 rounded hover:bg-red-700 transition">取消</button>
          )}
        </div>
        <div className="p-6 flex-grow flex flex-col">
          <div className="flex items-center space-x-4 mb-6 pb-6 border-b">
            <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center border-2 border-white shadow"><User size={24} className="text-gray-500" /></div>
            <div>
              <h3 className="font-bold text-lg">{isDriver ? '乘客' : '司機'}</h3>
              <div className="flex items-center space-x-1 text-gray-500 text-xs"><Star size={12} fill="currentColor" className="text-yellow-500" /><span>4.9</span></div>
              <div className="text-[10px] text-gray-400 mt-1">ID #{myCurrentRide?.id}</div>
            </div>
          </div>
          <div className="mt-auto">
             {isDriver ? (
               appState === 'DRIVER_EN_ROUTE' ? (
                  <button onClick={handleStartRide} disabled={loading} className="w-full bg-black text-white py-4 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition">確認接到乘客</button>
               ) : (<div className="w-full bg-green-50 border border-green-200 text-green-800 py-4 rounded-xl font-bold text-center">行程進行中...</div>)
            ) : (
               appState === 'IN_TRIP' ? (
                 <button onClick={handleCompleteRide} disabled={loading} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold shadow-lg hover:bg-green-700 transition">{loading ? '確認中...' : '確認到達 (付款)'}</button>
               ) : (<button disabled className="w-full bg-gray-100 text-gray-400 py-4 rounded-xl font-bold cursor-not-allowed">等待司機...</button>)
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRatingView = () => (
    <div className="flex-grow flex flex-col items-center justify-center p-8 bg-white z-50">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600"><ShieldCheck size={40} /></div>
      <h2 className="text-2xl font-bold mb-2">行程完成！</h2>
      <p className="text-gray-500 mb-8 text-center text-sm">資金已轉移。請評分。</p>
      <div className="flex space-x-3 mb-10">{[1, 2, 3, 4, 5].map(star => (<button key={star} onClick={() => handleRateDriver(star)} className="transform hover:scale-110 transition"><Star size={32} className="text-yellow-400 hover:fill-current" /></button>))}</div>
      {/* 修改：跳過按鈕，觸發 handleSkipRating */}
      <button onClick={handleSkipRating} className="text-gray-400 underline text-sm">跳過</button>
    </div>
  );

  return (
    <div className="font-sans text-gray-900 bg-gray-100 h-screen w-full flex flex-col md:flex-row overflow-hidden">
      {/* 左側 UI 面板 (固定寬度 400px 或 35%) */}
      <div className="w-full md:w-[400px] lg:w-[35%] md:min-w-[320px] md:max-w-[450px] flex-shrink-0 bg-white shadow-xl z-20 flex flex-col relative h-[60%] md:h-full order-2 md:order-1 rounded-t-2xl md:rounded-none">
        <Header />
        <div className="flex-grow overflow-hidden relative flex flex-col">
            {role === 'passenger' ? renderPassengerView() : renderDriverView()}
        </div>
      </div>

      {/* 右側地圖 (填滿剩餘空間) */}
      <div className="flex-grow relative z-0 h-[40%] md:h-full order-1 md:order-2">
        <LeafletMap 
          pickupCoords={pickupCoords} 
          dropoffCoords={dropoffCoords} 
          currentRide={myCurrentRide} 
          previewRide={previewRide} 
          onMapClick={handleMapClick} 
          driverCoords={driverCoords}
          userLocation={userLocation}
        />
        <button 
          onClick={handleLocateMe}
          className="absolute bottom-6 right-6 bg-white p-3 rounded-full shadow-lg z-10 hover:bg-gray-100 text-gray-700 transition-colors"
          title="定位我的位置"
        >
          <Crosshair size={24} />
        </button>
      </div>

      {loading && <LoadingOverlay />}
    </div>
  );
};

export default NTUberApp;
