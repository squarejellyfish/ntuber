# **NTUber – Decentralized Ride-Sharing DApp**

*A fully on-chain, peer-to-peer ride-hailing system built with Ethereum, Ethers.js, and Leaflet Maps.*

---

## **Overview**

**NTUber** is a decentralized alternative to traditional ride-sharing platforms. Instead of relying on centralized dispatch servers, NTUber uses an **Ethereum smart contract** to coordinate passengers, drivers, pricing, trip status, and payments.

* **Passengers** submit on-chain ride requests with pickup/dropoff coordinates + prepaid fare.
* **Drivers** monitor a live decentralized “order book” and accept rides.
* Trip progress is fully tracked on-chain.
* Funds are automatically released to the driver when the passenger confirms completion.
* Cancellations and refunds are also executed by the contract.

The frontend provides a polished Web2-like UI but is powered completely by Web3 interactions.

---

## **Core Features**

### **Blockchain & Web3**

* Full ride lifecycle tracked on-chain
* Secure value transfer (passenger → driver)
* Event-driven UI updates via contract listeners
* Sepolia testnet support (auto network switching)

### **UI & Mapping**

* Leaflet Map integration with markers, routing polylines, and dynamic previews
* Real-time location selection
* High-quality React UI with role-based views
* Interactive history panel

---

## **System Architecture**

NTUber has a **three-layer architecture**:

---

## **1. Smart Contract Layer (Ethereum Sepolia Testnet)**

The frontend interacts with a deployed smart contract that manages:

| Function           | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `requestRide()`    | Passenger creates a new ride & deposits ETH          |
| `acceptRide()`     | Driver accepts a ride                                |
| `startRide()`      | Driver indicates passenger pickup                    |
| `completeRide()`   | Passenger confirms dropoff → driver receives payment |
| `cancelRide()`     | Refund logic for cancellation                        |
| `rateDriver()`     | On-chain reputation system                           |
| `getRideDetails()` | Fetch ride info for UI                               |
| Events             | Used to auto-refresh app state                       |

Contract address (as used by the DApp):

```
0xa5a5d38a99dcd0863C62347337Bf90093A54eFeE
```

---

## **2. Frontend Web DApp (React)**

The file `NTUberApp.jsx` implements the entire UI logic and blockchain connection.
Major components include:

### **Web3 Initialization**

* Connects to MetaMask
* Auto-switches to Sepolia
* Loads signer, balance, and contract instance

### **Contract Sync**

* Fetches latest rides (`rideCount → getRideDetails`)
* Subscribes to events:

  * `RideRequested`
  * `RideAccepted`
  * `RideStarted`
  * `RideCompleted`
  * `RideCancelled`
  * `DriverRated`

Updates are reflected live across passenger/driver pages.

---

## **3. Mapping Layer (Leaflet)**

The file implements a custom **Leaflet Map** component:

### Features:

* Click-to-set pickup/dropoff
* Reverse geocoding using Nominatim
* Dynamic markers:

  * Black: pickup
  * Gray: destination
  * Animated "BIKE" icon when ride active
* Polyline route between points
* Preview mode for drivers viewing pending orders

---

## **Ride Lifecycle (On-Chain State Machine)**

```
Passenger → requestRide()
      |
      ▼
   Created
      |
Driver → acceptRide()
      |
      ▼
   Accepted (driver en route)
      |
Driver → startRide()
      |
      ▼
     Ongoing
      |
Passenger → completeRide()
      |
      ▼
   Completed → Funds released → Rating enabled
```

Cancellation is possible during *Created* or *Accepted* states.

---

## **Tech Stack**

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Blockchain     | Ethereum Sepolia Testnet                        |
| Smart Contract | EVM Solidity ABI (contract assumed precompiled) |
| Web3 Library   | Ethers.js v6                                    |
| Frontend       | React + Tailwind-style classes                  |
| Mapping        | Leaflet.js                                      |
| Geocoding      | Nominatim API                                   |

---

## **Local Development Setup**

### **Prerequisites**

* Node.js ≥ 18
* [MetaMask browser wallet](https://metamask.io/download)
* Sepolia ETH for testing (can go to faucet [Google Cloud Web3](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) to get testing ETH)

---

### **1. Install Dependencies**

```bash
npm install
```

(Required packages: `react`, `ethers`, `leaflet`, `lucide-react`, etc.)

---

### **2. Start Development Server**

```bash
npm run dev
```

---

### **3. Open Browser**

Visit:

```
http://localhost:5173/
```

---

## **Security Considerations**

* Contract must enforce amount validation
* Cancellations must check caller identity
* Ratings system should prevent duplicate scoring
* Reentrancy protection recommended on payment flow

---

## **Roadmap / Potential Enhancements**

* Live driver GPS tracking
* Dynamic pricing algorithm
* Zero-knowledge rider privacy
* Decentralized reputation oracle
