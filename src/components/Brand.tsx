import sipshiftMark from '../assets/sipshift-mark.svg'

type BrandProps = {
  className?: string
}

function Brand({ className }: BrandProps) {
  return (
    <span className={className ? `brand ${className}` : 'brand'}>
      <img
        className="brand__mark"
        src={sipshiftMark}
        width={48}
        height={48}
        alt=""
        aria-hidden="true"
      />
      <span className="brand__wordmark">SipShift</span>
    </span>
  )
}

export default Brand
