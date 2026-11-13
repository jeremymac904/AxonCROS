import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Loader2,Search} from 'lucide-react';
import {api,errorText} from '../lib/axon';
export type R3Props={route:string;onNavigate:(route:string)=>void;onDiscuss:(text:string,profileId?:string)=>void;onOpenChat?:(chatId:string,draft?:string)=>void};
export function useLocal<T>(path:string){const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');const generation=useRef(0);const load=useCallback(async(background=false)=>{const id=++generation.current;if(!background)setLoading(true);setError('');try{const result=await api<T>(path);if(id===generation.current)setData(result);return result}catch(e){if(id===generation.current)setError(errorText(e));return null}finally{if(id===generation.current)setLoading(false)}},[path]);useEffect(()=>{setData(null);void load();return()=>{generation.current++}},[load]);return{data,setData,loading,error,setError,load}}
export function ErrorNotice({error,retry}:{error:string;retry?:()=>void}){return error?<div className="ax-error" role="alert">{error}{retry&&<button onClick={retry}>Try again</button>}</div>:null}
export function Loading(){return <p className="ax-loading" role="status"><Loader2 className="ax-spin" size={18}/>Loading…</p>}
export function SearchField({value,onChange,label}:{value:string;onChange:(value:string)=>void;label:string}){return <label className="ax-search"><Search size={18}/><input aria-label={label} placeholder={label} value={value} onChange={e=>onChange(e.target.value)}/></label>}
export function PageHeading({title,subtitle,children}:{title:string;subtitle:string;children?:ReactNode}){return <header className="ax-page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{children||<span className="ax-tag">Local workspace</span>}</header>}
export function useAction(){const[busy,setBusy]=useState(false),[error,setError]=useState('');async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();return true}catch(e){setError(errorText(e));return false}finally{setBusy(false)}}return{busy,error,setError,run}}
export const dateOnly=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const shiftDate=(date:string,days:number)=>{const value=new Date(date+'T12:00:00');value.setDate(value.getDate()+days);return dateOnly(value)};
export const humanDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
export const labelOf=(value:string)=>value.replace(/-/g,' ').replace(/^./,s=>s.toUpperCase());
export const safeWebUrl=(value:string)=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:undefined}catch{return undefined}};
export async function fileBase64(file:File){if(file.size>5*1024*1024)throw new Error('Choose a file smaller than 5 MB.');return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('This file could not be read.'));reader.readAsDataURL(file)})}
