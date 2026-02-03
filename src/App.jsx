import React, { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, TrendingUp, Package, Car, Smartphone, Watch, Laptop, ChevronRight, Loader2, ImagePlus, RotateCcw, Share2, Bookmark, AlertCircle, Utensils, Shirt, Dumbbell, Scan, User, History, LogOut, Mail, ChevronLeft, Plus, Edit3, Trash2, Eye, Clock, Tag } from 'lucide-react';

export default function GetWorth() {
  const [currentView, setCurrentView] = useState('home');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [savedItems, setSavedItems] = useState([]);
  
  // Auth & User State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState('login'); // login, signup
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  
  // User Listings
  const [userListings, setUserListings] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [showListingForm, setShowListingForm] = useState(false);
  const [currentListing, setCurrentListing] = useState(null);
  const [listingForm, setListingForm] = useState({ description: '', condition: 'Good', quality: 'Good', reason: '' });

  const analyzeImage = async (imageData) => {
    try {
      // Use our serverless API endpoint to avoid CORS issues
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: imageData.split(',')[1] // Send only base64 data without prefix
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("API Error:", response.status, errorData);
        throw new Error(errorData.error || `API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.content?.[0]?.text) {
        const text = data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
      }
      
      throw new Error("Invalid response format");
    } catch (err) { 
      console.error("Analysis error:", err);
      throw err; 
    }
  };

  const handleFile = async (file) => {
    if (file?.type.startsWith('image/')) {
      setError(null);
      const reader = new FileReader();
      reader.onload = async (e) => {
        setUploadedImage(e.target.result);
        setCurrentView('analyzing');
        try {
          const result = await analyzeImage(e.target.result);
          setAnalysisResult(result);
          if (isLoggedIn) {
            setSearchHistory(prev => [{ ...result, image: e.target.result, date: new Date() }, ...prev.slice(0, 19)]);
          }
          setCurrentView('results');
        } catch { setError("Failed to analyze. Please try again."); setCurrentView('home'); }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrag = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragActive(e.type === "dragenter" || e.type === "dragover"); }, []);
  const handleDrop = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }, []);

  const startCamera = async () => {
    try {
      // First check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("Camera not supported on this device/browser.");
        return;
      }
      
      // Request camera permission - this will trigger the browser prompt
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      // Only switch to camera view after permission granted
      setCurrentView('camera');
      
      // Wait for video element to be ready
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(console.error);
        }
      }, 100);
      
    } catch (err) {
      console.error("Camera error:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError("Camera access denied. Please allow camera access in your browser settings and try again.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError("No camera found on this device.");
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError("Camera is already in use by another application.");
      } else if (err.name === 'OverconstrainedError') {
        // Try again with basic constraints
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          setCurrentView('camera');
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(console.error);
            }
          }, 100);
        } catch {
          setError("Could not access camera. Please try uploading an image instead.");
        }
      } else {
        setError("Could not access camera. Please try uploading an image instead.");
      }
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);
      const imageData = canvasRef.current.toDataURL('image/jpeg');
      setUploadedImage(imageData);
      videoRef.current.srcObject?.getTracks().forEach(t => t.stop());
      setCurrentView('analyzing');
      analyzeImage(imageData).then(r => {
        setAnalysisResult(r);
        if (isLoggedIn) setSearchHistory(prev => [{ ...r, image: imageData, date: new Date() }, ...prev.slice(0, 19)]);
        setCurrentView('results');
      }).catch(() => { setError("Failed to analyze."); setCurrentView('home'); });
    }
  };

  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(t => t.stop()); setCurrentView('home'); };
  const resetApp = () => { setUploadedImage(null); setAnalysisResult(null); setCurrentView('home'); setError(null); };
  const formatPrice = (p) => p === 0 ? "N/A" : p < 1 ? `$${p.toFixed(2)}` : `$${p.toLocaleString()}`;
  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Auth Functions
  const handleLogin = (e) => {
    e.preventDefault();
    setUser({ name: authForm.name || authForm.email.split('@')[0], email: authForm.email });
    setIsLoggedIn(true);
    setCurrentView('home');
    setAuthForm({ name: '', email: '', password: '' });
  };

  const handleSocialLogin = (provider) => {
    setUser({ name: `${provider} User`, email: `user@${provider.toLowerCase()}.com`, provider });
    setIsLoggedIn(true);
    setCurrentView('home');
  };

  const handleLogout = () => { setIsLoggedIn(false); setUser(null); setSearchHistory([]); setUserListings([]); setCurrentView('home'); };

  const addToListings = () => {
    if (analysisResult && uploadedImage) {
      setCurrentListing({ ...analysisResult, image: uploadedImage });
      setListingForm({ description: analysisResult.details?.description || '', condition: analysisResult.condition || 'Good', quality: 'Good', reason: '' });
      setShowListingForm(true);
    }
  };

  const saveListing = () => {
    if (currentListing) {
      const listing = { ...currentListing, ...listingForm, id: Date.now(), createdAt: new Date() };
      setUserListings(prev => [listing, ...prev]);
      setShowListingForm(false);
      setCurrentListing(null);
      setListingForm({ description: '', condition: 'Good', quality: 'Good', reason: '' });
    }
  };

  const deleteListing = (id) => setUserListings(prev => prev.filter(l => l.id !== id));

  const getCategoryIcon = (c) => ({ Electronics: Smartphone, Vehicles: Car, Watches: Watch, Food: Utensils, Clothing: Shirt, Sports: Dumbbell }[c] || Package);
  const CategoryIcon = ({ category, className }) => { const Icon = getCategoryIcon(category); return <Icon className={className || "w-5 h-5"} />; };

  // Clean Premium UI Components
  const Card = ({ children, className = '', style = {} }) => (
    <div className={`rounded-2xl ${className}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...style }}>{children}</div>
  );

  const Button = ({ children, primary, className = '', ...props }) => (
    <button className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'} ${className}`} {...props}>{children}</button>
  );

  const Input = ({ label, ...props }) => (
    <div className="space-y-2">
      {label && <label className="text-sm text-slate-400">{label}</label>}
      <input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/8 transition-all" {...props} />
    </div>
  );

  return (
    <div className="min-h-screen text-white" style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#0a0f1a' }}>
      {/* Clean gradient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.15), transparent)' }} />
      </div>

      <div className="relative max-w-md mx-auto min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3" onClick={() => { resetApp(); setShowListingForm(false); }} style={{ cursor: 'pointer' }}>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">GetWorth</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">AI Valuation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentView !== 'home' && currentView !== 'camera' && currentView !== 'auth' && currentView !== 'profile' && (
              <button onClick={resetApp} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                <RotateCcw className="w-4 h-4 text-slate-400" />
              </button>
            )}
            <button onClick={() => setCurrentView(isLoggedIn ? 'profile' : 'auth')} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
              <User className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </header>

        {/* Error Toast */}
        {error && (
          <div className="mx-5 mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-sm text-red-300 flex-1">{error}</p>
            <button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400" /></button>
          </div>
        )}

        <main className="flex-1 px-5 pb-8">
          
          {/* AUTH VIEW */}
          {currentView === 'auth' && (
            <div className="space-y-6 animate-fadeIn pt-8">
              <button onClick={() => setCurrentView('home')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
                <span className="text-sm">Back</span>
              </button>

              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold">{authView === 'login' ? 'Welcome back' : 'Create account'}</h2>
                <p className="text-slate-400 text-sm">{authView === 'login' ? 'Sign in to access your listings' : 'Join GetWorth to list your items'}</p>
              </div>

              {/* Social Login */}
              <div className="space-y-3">
                <button onClick={() => handleSocialLogin('Google')} className="w-full py-3.5 rounded-xl bg-white/5 border border-white/10 font-medium flex items-center justify-center gap-3 hover:bg-white/10 transition-all">
                  <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </button>
                <button onClick={() => handleSocialLogin('Apple')} className="w-full py-3.5 rounded-xl bg-white/5 border border-white/10 font-medium flex items-center justify-center gap-3 hover:bg-white/10 transition-all">
                  <svg className="w-5 h-5" fill="white" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  Continue with Apple
                </button>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-slate-500">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Email Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                {authView === 'signup' && (
                  <Input label="Full Name" placeholder="John Doe" value={authForm.name} onChange={(e) => setAuthForm({...authForm, name: e.target.value})} />
                )}
                <Input label="Email" type="email" placeholder="you@example.com" value={authForm.email} onChange={(e) => setAuthForm({...authForm, email: e.target.value})} required />
                <Input label="Password" type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required />
                <Button primary className="w-full py-3.5">{authView === 'login' ? 'Sign In' : 'Create Account'}</Button>
              </form>

              <p className="text-center text-sm text-slate-400">
                {authView === 'login' ? "Don't have an account? " : "Already have an account? "}
                <button onClick={() => setAuthView(authView === 'login' ? 'signup' : 'login')} className="text-blue-400 hover:text-blue-300">{authView === 'login' ? 'Sign up' : 'Sign in'}</button>
              </p>
            </div>
          )}

          {/* PROFILE VIEW */}
          {currentView === 'profile' && isLoggedIn && !showListingForm && (
            <div className="space-y-6 animate-fadeIn">
              <button onClick={() => setCurrentView('home')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
                <span className="text-sm">Back</span>
              </button>

              {/* User Info */}
              <Card className="p-5">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-2xl font-bold">
                    {user?.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{user?.name}</h3>
                    <p className="text-sm text-slate-400">{user?.email}</p>
                  </div>
                  <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
                    <LogOut className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
              </Card>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-400">{userListings.length}</p>
                  <p className="text-xs text-slate-500 mt-1">My Listings</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-400">{searchHistory.length}</p>
                  <p className="text-xs text-slate-500 mt-1">Searches</p>
                </Card>
              </div>

              {/* My Listings */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-blue-400" />My Listings</h3>
                </div>
                {userListings.length === 0 ? (
                  <Card className="p-8 text-center">
                    <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">No listings yet</p>
                    <p className="text-slate-500 text-xs mt-1">Scan items and add them to your listings</p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {userListings.map((item) => (
                      <Card key={item.id} className="p-4">
                        <div className="flex gap-3">
                          <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 flex-shrink-0">
                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{item.name}</h4>
                            <p className="text-lg font-bold text-blue-400">{formatPrice(item.marketValue?.mid)}</p>
                            <div className="flex gap-2 mt-1">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400">{item.condition}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400">{item.quality}</span>
                            </div>
                          </div>
                          <button onClick={() => deleteListing(item.id)} className="p-2 rounded-lg hover:bg-red-500/10 transition-colors self-start">
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                        {item.reason && (
                          <div className="mt-3 pt-3 border-t border-white/5">
                            <p className="text-xs text-slate-500">Reason for selling:</p>
                            <p className="text-sm text-slate-300 mt-1">{item.reason}</p>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Search History */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2"><History className="w-4 h-4 text-blue-400" />Search History</h3>
                {searchHistory.length === 0 ? (
                  <Card className="p-8 text-center">
                    <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">No search history</p>
                    <p className="text-slate-500 text-xs mt-1">Your scanned items will appear here</p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {searchHistory.map((item, i) => (
                      <Card key={i} className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5">
                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{item.name}</p>
                            <p className="text-xs text-slate-500">{formatDate(item.date)}</p>
                          </div>
                          <p className="font-semibold text-blue-400">{formatPrice(item.marketValue?.mid)}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LISTING FORM */}
          {showListingForm && currentListing && (
            <div className="space-y-6 animate-fadeIn">
              <button onClick={() => { setShowListingForm(false); setCurrentListing(null); }} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
                <span className="text-sm">Back</span>
              </button>

              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold">Add to Listings</h2>
                <p className="text-slate-400 text-sm">Provide details about your item</p>
              </div>

              {/* Item Preview */}
              <Card className="p-4">
                <div className="flex gap-4">
                  <div className="w-24 h-24 rounded-xl overflow-hidden bg-white/5">
                    <img src={currentListing.image} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{currentListing.name}</h3>
                    <p className="text-2xl font-bold text-blue-400 mt-1">{formatPrice(currentListing.marketValue?.mid)}</p>
                    <p className="text-xs text-slate-500 mt-1">{currentListing.category}</p>
                  </div>
                </div>
              </Card>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-slate-400">Description</label>
                  <textarea 
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all resize-none h-24"
                    placeholder="Describe your item..."
                    value={listingForm.description}
                    onChange={(e) => setListingForm({...listingForm, description: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400">Condition</label>
                    <select 
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 transition-all"
                      value={listingForm.condition}
                      onChange={(e) => setListingForm({...listingForm, condition: e.target.value})}
                    >
                      <option value="New">New</option>
                      <option value="Like New">Like New</option>
                      <option value="Excellent">Excellent</option>
                      <option value="Good">Good</option>
                      <option value="Fair">Fair</option>
                      <option value="Poor">Poor</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400">Quality</label>
                    <select 
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 transition-all"
                      value={listingForm.quality}
                      onChange={(e) => setListingForm({...listingForm, quality: e.target.value})}
                    >
                      <option value="Excellent">Excellent</option>
                      <option value="Good">Good</option>
                      <option value="Average">Average</option>
                      <option value="Below Average">Below Average</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-slate-400">Reason for Selling</label>
                  <textarea 
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all resize-none h-20"
                    placeholder="Why are you selling this item?"
                    value={listingForm.reason}
                    onChange={(e) => setListingForm({...listingForm, reason: e.target.value})}
                  />
                </div>

                <Button primary className="w-full py-4" onClick={saveListing}>
                  <Plus className="w-4 h-4" />
                  Add to My Listings
                </Button>
              </div>
            </div>
          )}

          {/* HOME */}
          {currentView === 'home' && (
            <div className="space-y-8 animate-fadeIn">
              {/* Hero */}
              <div className="text-center space-y-4 pt-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium text-blue-300">AI-Powered</span>
                </div>
                <h2 className="text-4xl font-bold leading-tight">
                  Know Your<br/>
                  <span className="text-blue-400">Item's Value</span>
                </h2>
                <p className="text-slate-400 text-sm max-w-[260px] mx-auto">Snap or upload any item. Get instant AI valuation.</p>
              </div>

              {/* Upload Area */}
              <div
                className={`relative rounded-2xl transition-all duration-300 ${dragActive ? 'scale-[1.02] border-blue-500/50 bg-blue-500/5' : 'border-white/10 bg-white/[0.02]'}`}
                style={{ border: '2px dashed' }}
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
                <div className="p-10 text-center space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 flex items-center justify-center">
                    <ImagePlus className="w-7 h-7 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-slate-300 font-medium">Drop image here</p>
                    <p className="text-slate-500 text-sm mt-1">or use the buttons below</p>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={startCamera} className="py-4 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 font-semibold">
                  <Scan className="w-5 h-5" />
                  Scan
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-center gap-2 font-semibold">
                  <Upload className="w-5 h-5" />
                  Upload
                </button>
              </div>

              {/* Categories */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Categories</h3>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                  {[
                    { icon: Smartphone, label: 'Phones' },
                    { icon: Laptop, label: 'Laptops' },
                    { icon: Car, label: 'Vehicles' },
                    { icon: Watch, label: 'Watches' },
                    { icon: Shirt, label: 'Clothing' },
                    { icon: Package, label: 'Other' },
                  ].map((item, i) => (
                    <div key={i} className="flex-shrink-0 px-4 py-3 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2 cursor-pointer hover:bg-white/10 transition-colors">
                      <item.icon className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-300">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent (for logged in users) */}
              {isLoggedIn && searchHistory.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Searches</h3>
                  <div className="space-y-2">
                    {searchHistory.slice(0, 3).map((item, i) => (
                      <Card key={i} className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5">
                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.category}</p>
                          </div>
                          <p className="font-semibold text-blue-400 text-sm">{formatPrice(item.marketValue?.mid)}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CAMERA */}
          {currentView === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-12 rounded-2xl border-2 border-white/20" />
                <div className="absolute top-12 left-12 w-8 h-8 border-l-2 border-t-2 border-blue-500 rounded-tl-lg" />
                <div className="absolute top-12 right-12 w-8 h-8 border-r-2 border-t-2 border-blue-500 rounded-tr-lg" />
                <div className="absolute bottom-12 left-12 w-8 h-8 border-l-2 border-b-2 border-blue-500 rounded-bl-lg" />
                <div className="absolute bottom-12 right-12 w-8 h-8 border-r-2 border-b-2 border-blue-500 rounded-br-lg" />
              </div>
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black/90 to-transparent">
                <button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><X className="w-6 h-6" /></button>
                <button onClick={capturePhoto} className="w-18 h-18 rounded-full bg-blue-600 flex items-center justify-center active:scale-95 transition-transform" style={{width: '72px', height: '72px'}}><div className="w-14 h-14 rounded-full border-4 border-white/30" /></button>
                <div className="w-14" />
              </div>
              <p className="absolute top-16 inset-x-0 text-center text-sm text-white/60">Position item in frame</p>
            </div>
          )}

          {/* ANALYZING */}
          {currentView === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 animate-fadeIn">
              <div className="relative">
                <div className="absolute -inset-4 rounded-2xl bg-blue-500/20 blur-2xl animate-pulse" />
                <div className="relative w-48 h-48 rounded-2xl overflow-hidden border-2 border-blue-500/30">
                  {uploadedImage && <img src={uploadedImage} alt="" className="w-full h-full object-cover" />}
                </div>
              </div>
              <div className="mt-8 text-center space-y-4">
                <div className="flex items-center justify-center gap-3">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                  <span className="text-lg font-medium">Analyzing...</span>
                </div>
                <p className="text-sm text-slate-500">Identifying item and market value</p>
              </div>
            </div>
          )}

          {/* RESULTS */}
          {currentView === 'results' && analysisResult && (
            <div className="space-y-5 animate-fadeIn pb-4">
              {/* Image */}
              <div className="relative">
                <div className="aspect-[4/3] rounded-2xl overflow-hidden">
                  <img src={uploadedImage} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent to-transparent" />
                </div>
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 backdrop-blur">
                  <span className="text-xs font-semibold text-emerald-400">{Math.round(analysisResult.confidence * 100)}%</span>
                </div>
                {!analysisResult.isSellable && (
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 backdrop-blur">
                    <span className="text-xs font-semibold text-amber-400">Not Sellable</span>
                  </div>
                )}
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <CategoryIcon category={analysisResult.category} className="w-4 h-4" />
                    <span>{analysisResult.category}</span>
                  </div>
                  <h2 className="text-xl font-bold">{analysisResult.name}</h2>
                </div>
              </div>

              {/* Value Card */}
              <Card className="p-5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.02) 100%)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-sm text-slate-400">Market Value</span>
                  <div className="flex items-center gap-1.5">
                    {analysisResult.marketTrend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-400" />}
                    {analysisResult.marketTrend === 'down' && <TrendingUp className="w-4 h-4 text-red-400 rotate-180" />}
                    <span className="text-xs text-slate-500 capitalize">{analysisResult.marketTrend !== 'not-applicable' && analysisResult.marketTrend}</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-blue-400">{formatPrice(analysisResult.marketValue?.mid)}</p>
                  {analysisResult.marketValue?.low > 0 && (
                    <p className="text-sm text-slate-500 mt-1">Range: {formatPrice(analysisResult.marketValue.low)} – {formatPrice(analysisResult.marketValue.high)}</p>
                  )}
                </div>
              </Card>

              {/* Details */}
              <Card className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-blue-400" />Details</h3>
                {analysisResult.details?.description && <p className="text-sm text-slate-300">{analysisResult.details.description}</p>}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="p-3 rounded-lg bg-white/5">
                    <p className="text-[10px] text-slate-500 uppercase">Brand</p>
                    <p className="text-sm font-medium mt-0.5">{analysisResult.details?.brand || 'Unknown'}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <p className="text-[10px] text-slate-500 uppercase">Condition</p>
                    <p className="text-sm font-medium mt-0.5">{analysisResult.condition}</p>
                  </div>
                </div>
              </Card>

              {/* Price Factors */}
              {analysisResult.priceFactors?.length > 0 && (
                <Card className="p-4 space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-400" />Value Factors</h3>
                  {analysisResult.priceFactors.map((f, i) => (
                    <div key={i} className="flex justify-between py-2 border-b border-white/5 last:border-0">
                      <span className="text-sm text-slate-400">{f.factor}</span>
                      <span className="text-sm font-medium text-blue-400">{f.impact}</span>
                    </div>
                  ))}
                </Card>
              )}

              {/* Tips */}
              {analysisResult.sellingTips && (
                <Card className="p-4" style={{ background: 'rgba(59,130,246,0.05)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-blue-400" />Tip</h3>
                  <p className="text-sm text-slate-300">{analysisResult.sellingTips}</p>
                </Card>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                {isLoggedIn ? (
                  <Button primary className="flex-1 py-3.5" onClick={addToListings}>
                    <Plus className="w-4 h-4" />
                    Add to Listings
                  </Button>
                ) : (
                  <Button primary className="flex-1 py-3.5" onClick={() => setCurrentView('auth')}>
                    <User className="w-4 h-4" />
                    Sign in to List
                  </Button>
                )}
                <Button className="py-3.5"><Share2 className="w-4 h-4" /></Button>
              </div>
              <button onClick={resetApp} className="w-full py-3 text-slate-400 text-sm hover:text-white transition-colors flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" />
                Scan Another
              </button>
            </div>
          )}
        </main>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
        select option { background: #0a0f1a; }
      `}</style>
    </div>
  );
}
