import { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import FloatingParticles from '../FloatingParticles/FloatingParticles';
import './RegisterPage.css';

import api from '../../utils/api';
import { Warning, Check } from '../Icons';

interface CustomSelectProps {
  options: { value: string; label: string }[] | string[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}

function CustomSelect({ options, value, onChange, placeholder }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedOptions = options.map(opt => 
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  );

  const selectedOption = normalizedOptions.find(o => o.value === value);

  return (
    <div className="custom-select-container" ref={containerRef}>
      <div 
        className={`custom-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <span className="custom-select-arrow">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </div>
      {isOpen && (
        <div className="custom-select-options">
          {normalizedOptions.map(opt => (
            <div 
              key={opt.value}
              className={`custom-select-option ${opt.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [birthYear, setBirthYear] = useState('');

  const MONTHS = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  const currentYear = new Date().getFullYear();
  const YEARS = Array.from({ length: 120 }, (_, i) => String(currentYear - i));

  // Compute days list dynamically based on chosen month and year
  const getDaysList = () => {
    let daysCount = 31;
    if (birthMonth) {
      const monthNum = parseInt(birthMonth);
      const yearNum = birthYear ? parseInt(birthYear) : 2000; // safe placeholder
      daysCount = new Date(yearNum, monthNum, 0).getDate();
    }
    return Array.from({ length: daysCount }, (_, i) => String(i + 1));
  };

  // Keep single birthdate string state synced with month/day/year selects
  useEffect(() => {
    if (birthYear && birthMonth && birthDay) {
      const formattedMonth = birthMonth.padStart(2, '0');
      const formattedDay = birthDay.padStart(2, '0');
      setBirthdate(`${birthYear}-${formattedMonth}-${formattedDay}`);
    } else {
      setBirthdate('');
    }
  }, [birthYear, birthMonth, birthDay]);

  // Adjust days if transitioning to a month with fewer days (e.g. 31 to 30 or Feb leap year)
  useEffect(() => {
    if (birthMonth) {
      const monthNum = parseInt(birthMonth);
      const yearNum = birthYear ? parseInt(birthYear) : 2000;
      const maxDays = new Date(yearNum, monthNum, 0).getDate();
      if (birthDay && parseInt(birthDay) > maxDays) {
        setBirthDay(String(maxDays));
      }
    }
  }, [birthMonth, birthYear, birthDay]);

  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(1); // 1 = Register Form, 2 = OTP Verification
  const [loading, setLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sentOtp, setSentOtp] = useState('');

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(cardRef.current,
        { opacity: 0, y: 30, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'power3.out', delay: 0.1 }
      );
    }
  }, []);

  // SPA navigation helper
  const handleNavigate = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !username || !password || !birthdate) {
      setError('Please provide all required fields');
      return;
    }
    
    // 🚀 Snippy UX: Instantly transition to OTP step
    setStep(2);
    setRegisterLoading(true);
    setError('');
    setMessage('');
    setSentOtp('');

    try {
      const response = await api.post('/auth/register', { email, username, password, birthdate });
      const data = response.data;
      if (data.success) {
        if (data.otp) {
          setSentOtp(data.otp);
        }
        setMessage(data.message || 'OTP sent to email. Please verify.');
      } else {
        // Revert back to form step to display error
        setStep(1);
        setError(data.error || data.message || 'Registration failed');
      }
    } catch (err: any) {
      // Revert back to form step to display error
      setStep(1);
      const errMsg = err.response?.data?.error || err.response?.data?.message || 'Connection failed. Is the server running?';
      setError(errMsg);
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.post('/auth/verify-otp', { email, otp });
      const data = response.data;
      if (data.success) {
        setMessage('Account verified successfully! Redirecting...');
        if (data.token) {
          localStorage.setItem('token', data.token);
        }
        localStorage.setItem('user', JSON.stringify(data.user));

        setTimeout(() => {
          window.history.pushState({}, '', '/home');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, 1500);
      } else {
        setError(data.error || 'Verification failed. Please try again.');
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.response?.data?.message || 'Verification failed. Please try again.';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.post('/auth/resend-otp', { email });
      const data = response.data;
      if (data.success) {
        if (data.otp) {
          setSentOtp(data.otp);
        }
        setMessage(data.message || 'New OTP sent successfully.');
      } else {
        setError(data.error || 'Failed to resend OTP.');
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.response?.data?.message || 'Connection failed. Please try again.';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="register-bg-overlay" />
      <FloatingParticles />

      <div className="register-card" ref={cardRef}>
        <div className="register-inner">
          {step === 1 ? (
            <>
              <div className="register-header">
                <h1 className="register-title">Create an account</h1>
              </div>

              <form className="register-form" onSubmit={handleRegisterSubmit} style={{ width: '100%' }}>
                {error && (
                  <div style={{ color: '#f23f43', fontSize: '14px', width: '100%', marginBottom: '16px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Warning size={16} color="#f23f43" /> {error}
                  </div>
                )}

                <div className="register-fields">
                  <div className="field-group">
                    <label className="field-label" htmlFor="email">EMAIL</label>
                    <input
                      id="email"
                      type="email"
                      className="field-input"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="username">USERNAME</label>
                    <input
                      id="username"
                      type="text"
                      className="field-input"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="password">PASSWORD</label>
                    <input
                      id="password"
                      type="password"
                      className="field-input"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">DATE OF BIRTH</label>
                    <div className="dob-selects">
                      <CustomSelect
                        options={MONTHS}
                        value={birthMonth}
                        onChange={setBirthMonth}
                        placeholder="Month"
                      />
                      <CustomSelect
                        options={getDaysList()}
                        value={birthDay}
                        onChange={setBirthDay}
                        placeholder="Day"
                      />
                      <CustomSelect
                        options={YEARS}
                        value={birthYear}
                        onChange={setBirthYear}
                        placeholder="Year"
                      />
                    </div>
                  </div>
                </div>

                <button type="submit" className="register-btn" disabled={registerLoading} style={{ marginTop: '20px' }}>
                  {registerLoading ? 'Sending the email...' : 'Register'}
                </button>

                <p className="login-text" style={{ marginTop: '12px' }}>
                  Already have an account?{' '}
                  <a href="/login" onClick={(e) => handleNavigate(e, '/login')} className="login-link">Log in</a>
                </p>
              </form>
            </>
          ) : (
            <>
              <div className="register-header">
                <h1 className="register-title" style={{ color: '#23a55a' }}>Verify your email</h1>
                <p className="register-subtitle" style={{ fontSize: '15px', marginTop: '10px', color: 'rgba(194, 206, 214, 0.70)' }}>
                  We sent a 6-digit code to <strong>{email}</strong>
                  {sentOtp ? (
                    <span style={{ display: 'block', marginTop: '8px', color: '#14AC7B', fontWeight: '500' }}>
                      Verification Code: <strong style={{ color: '#ffffff', letterSpacing: '1px', fontSize: '16px' }}>{sentOtp}</strong>
                    </span>
                  ) : (
                    registerLoading && (
                      <span className="otp-generating-loader" style={{ display: 'block', marginTop: '8px', color: '#14AC7B', fontWeight: '500' }}>
                        Generating verification code...
                      </span>
                    )
                  )}
                </p>
              </div>

              <form className="register-form" onSubmit={handleVerifySubmit} style={{ width: '100%' }}>
                {error && (
                  <div style={{ color: '#f23f43', fontSize: '14px', width: '100%', marginBottom: '16px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Warning size={16} color="#f23f43" /> {error}
                  </div>
                )}
                {message && (
                  <div style={{ color: '#23a55a', fontSize: '14px', width: '100%', marginBottom: '16px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={16} color="#23a55a" /> {message}
                  </div>
                )}

                <div className="register-fields">
                  <div className="field-group">
                    <label className="field-label" htmlFor="otp">6-DIGIT VERIFICATION CODE</label>
                    <input
                      id="otp"
                      type="text"
                      className="field-input"
                      maxLength={6}
                      placeholder={sentOtp || "e.g. 123456"}
                      value={otp}
                      disabled={registerLoading}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} // numbers only
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="register-btn" disabled={loading || registerLoading} style={{ marginTop: '20px' }}>
                  {registerLoading ? 'Preparing verification...' : loading ? 'Verifying...' : 'Verify & Complete'}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: '12px' }}>
                  <a 
                    href="#" 
                    onClick={registerLoading ? (e) => e.preventDefault() : handleResendOtp} 
                    className="login-link" 
                    style={{ fontSize: '14px', opacity: registerLoading ? 0.5 : 1, cursor: registerLoading ? 'not-allowed' : 'pointer' }}
                  >
                    Resend Code
                  </a>
                  <a 
                    href="#" 
                    onClick={registerLoading ? (e) => e.preventDefault() : (e) => { e.preventDefault(); setStep(1); }} 
                    className="login-link" 
                    style={{ fontSize: '14px', color: '#c2ced6', opacity: registerLoading ? 0.5 : 1, cursor: registerLoading ? 'not-allowed' : 'pointer' }}
                  >
                    Back
                  </a>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
